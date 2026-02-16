#!/usr/bin/env bun
/**
 * AI Trader — Continuous Trading Runner
 *
 * 파이프라인(수집→분석→리밸런싱→거래→모니터링)을 설정된 간격으로 반복 실행합니다.
 * 대시보드에서 시작/정지를 제어하며, 상태는 JSON 파일로 공유됩니다.
 *
 * Usage:
 *   bun run src/runner.ts              # config.yaml의 설정으로 실행
 *   bun run src/runner.ts --once       # 1회만 실행 후 종료
 */
import { resolve } from 'path';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { parse } from 'yaml';

const PROJECT_ROOT = resolve(import.meta.dirname, '..');
const STATUS_FILE = '/tmp/ai-trader-runner-status.json';
const CONTROL_FILE = '/tmp/ai-trader-runner-control.json';

// ─── Types ───

interface StepResult {
	success: boolean;
	durationMs: number;
	error?: string;
}

interface CycleResult {
	startedAt: string;
	completedAt: string;
	success: boolean;
	steps: Record<string, StepResult>;
	durationMs: number;
}

interface RunnerStatus {
	state: 'running' | 'idle' | 'stopped' | 'error';
	pid: number;
	startedAt: string;
	cycleCount: number;
	successCount: number;
	failCount: number;
	lastCycle: CycleResult | null;
	nextCycleAt: string | null;
	intervalSec: number;
	mode: string;
	updatedAt: string;
	stoppedAt?: string;
	stopReason?: string;
}

// ─── Config ───

function loadConfig(): Record<string, any> {
	const configPath = resolve(PROJECT_ROOT, 'config.yaml');
	if (!existsSync(configPath)) return {};
	return parse(readFileSync(configPath, 'utf-8')) as Record<string, any>;
}

function getRunnerConfig() {
	const config = loadConfig();
	const runner = config?.runner ?? {};
	return {
		intervalSec: runner.interval_sec ?? 300,        // 기본 5분
		maxCycles: runner.max_cycles ?? 0,              // 0 = 무한
		pauseBetweenStepsSec: runner.pause_between_steps_sec ?? 2,
		cooldownOnErrorSec: runner.cooldown_on_error_sec ?? 60,
		maxConsecutiveErrors: runner.max_consecutive_errors ?? 10,
	};
}

function getMode(): string {
	const config = loadConfig();
	return config?.general?.mode || 'paper';
}

function isKillSwitchActive(): boolean {
	const config = loadConfig();
	const ksFile = config?.trade_agent?.safety?.kill_switch_file || 'data/KILL_SWITCH';
	return existsSync(resolve(PROJECT_ROOT, ksFile));
}

// ─── Status File ───

let status: RunnerStatus = {
	state: 'idle',
	pid: process.pid,
	startedAt: new Date().toISOString(),
	cycleCount: 0,
	successCount: 0,
	failCount: 0,
	lastCycle: null,
	nextCycleAt: null,
	intervalSec: 300,
	mode: 'paper',
	updatedAt: new Date().toISOString(),
};

function writeStatus() {
	status.updatedAt = new Date().toISOString();
	const tmp = STATUS_FILE + '.tmp';
	writeFileSync(tmp, JSON.stringify(status, null, 2));
	try {
		// atomic rename
		const fs = require('fs');
		fs.renameSync(tmp, STATUS_FILE);
	} catch {
		writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2));
	}
}

// ─── Control File ───

function checkControlFile(): string | null {
	if (!existsSync(CONTROL_FILE)) return null;
	try {
		const raw = readFileSync(CONTROL_FILE, 'utf-8');
		const ctrl = JSON.parse(raw);
		unlinkSync(CONTROL_FILE);
		return ctrl.command ?? null;
	} catch {
		try { unlinkSync(CONTROL_FILE); } catch {}
		return null;
	}
}

// ─── Script Execution ───

const SCRIPTS: { id: string; label: string; file: string; args: string[]; critical: boolean }[] = [
	{ id: 'collect', label: '가격 수집', file: 'skills/data-collector/scripts/collect-prices.ts', args: [], critical: true },
	{ id: 'analyze', label: '시그널 분석', file: 'skills/analyzer/scripts/analyze.ts', args: [], critical: true },
	{ id: 'rebalance', label: '자금 리밸런싱', file: 'skills/wallet-manager/scripts/manage-wallet.ts', args: ['--action', 'auto-rebalance'], critical: false },
	{ id: 'trade', label: '거래 실행', file: 'skills/trader/scripts/execute-trade.ts', args: [], critical: false },
	{ id: 'monitor', label: '포지션 모니터링', file: 'skills/trader/scripts/execute-trade.ts', args: ['--action', 'monitor'], critical: false },
];

async function runStep(step: typeof SCRIPTS[0], timeoutMs = 60_000): Promise<StepResult> {
	const start = Date.now();
	const scriptPath = resolve(PROJECT_ROOT, step.file);

	try {
		const proc = Bun.spawn(['bun', 'run', scriptPath, ...step.args], {
			cwd: PROJECT_ROOT,
			stdout: 'pipe',
			stderr: 'pipe',
			env: { ...process.env },
		});

		const timer = setTimeout(() => proc.kill(), timeoutMs);
		const exitCode = await proc.exited;
		clearTimeout(timer);

		const stderr = await new Response(proc.stderr).text();
		const durationMs = Date.now() - start;

		if (exitCode !== 0) {
			return { success: false, durationMs, error: stderr.trim().slice(0, 500) || `exit code ${exitCode}` };
		}
		return { success: true, durationMs };
	} catch (err) {
		return { success: false, durationMs: Date.now() - start, error: err instanceof Error ? err.message : String(err) };
	}
}

// ─── Pipeline Cycle ───

async function runCycle(pauseBetweenSec: number): Promise<CycleResult> {
	const cycleStart = Date.now();
	const steps: Record<string, StepResult> = {};
	let overallSuccess = true;

	for (const step of SCRIPTS) {
		log(`  [${step.id}] ${step.label} 시작...`);
		const result = await runStep(step);
		steps[step.id] = result;

		if (result.success) {
			log(`  [${step.id}] 완료 (${result.durationMs}ms)`);
		} else {
			log(`  [${step.id}] 실패: ${result.error}`);
			if (step.critical) {
				overallSuccess = false;
				log(`  ⚠ critical step 실패 — 나머지 스킵`);
				break;
			}
		}

		// 킬스위치 체크
		if (isKillSwitchActive()) {
			log('  ⛔ Kill switch 활성 — 사이클 중단');
			overallSuccess = false;
			break;
		}

		// 컨트롤 파일 체크
		const cmd = checkControlFile();
		if (cmd === 'stop') {
			log('  🛑 정지 요청 수신 — 사이클 중단');
			overallSuccess = false;
			break;
		}

		// 스텝 간 쿨다운
		if (pauseBetweenSec > 0 && step !== SCRIPTS[SCRIPTS.length - 1]) {
			await sleep(pauseBetweenSec * 1000);
		}
	}

	return {
		startedAt: new Date(cycleStart).toISOString(),
		completedAt: new Date().toISOString(),
		success: overallSuccess,
		steps,
		durationMs: Date.now() - cycleStart,
	};
}

// ─── Logging ───

function log(msg: string) {
	const ts = new Date().toLocaleTimeString('ko-KR', { hour12: false });
	console.log(`[${ts}] ${msg}`);
}

function sleep(ms: number) {
	return new Promise(r => setTimeout(r, ms));
}

// ─── Main Loop ───

async function main() {
	const onceMode = process.argv.includes('--once');
	const runnerConfig = getRunnerConfig();
	const mode = getMode();

	log('═══════════════════════════════════════════');
	log(`AI Trader Runner 시작`);
	log(`  모드: ${mode.toUpperCase()}`);
	log(`  간격: ${runnerConfig.intervalSec}초`);
	log(`  최대 사이클: ${runnerConfig.maxCycles || '무한'}`);
	log(`  PID: ${process.pid}`);
	if (onceMode) log(`  ⚡ 1회 실행 모드`);
	log('═══════════════════════════════════════════');

	status.state = 'running';
	status.pid = process.pid;
	status.startedAt = new Date().toISOString();
	status.intervalSec = runnerConfig.intervalSec;
	status.mode = mode;
	writeStatus();

	let consecutiveErrors = 0;

	// Graceful shutdown
	const shutdown = (signal: string) => {
		log(`\n${signal} 수신 — 종료 중...`);
		status.state = 'stopped';
		status.stoppedAt = new Date().toISOString();
		status.stopReason = signal;
		writeStatus();
		process.exit(0);
	};
	process.on('SIGINT', () => shutdown('SIGINT'));
	process.on('SIGTERM', () => shutdown('SIGTERM'));

	while (true) {
		// 킬스위치 확인
		if (isKillSwitchActive()) {
			log('⛔ Kill switch 활성 — 대기 중...');
			status.state = 'idle';
			writeStatus();
			await sleep(10_000);
			continue;
		}

		// 컨트롤 파일 확인
		const cmd = checkControlFile();
		if (cmd === 'stop') {
			log('🛑 정지 명령 수신');
			status.state = 'stopped';
			status.stoppedAt = new Date().toISOString();
			status.stopReason = 'dashboard stop command';
			writeStatus();
			break;
		}

		// 설정 재로드 (매 사이클마다)
		const cfg = getRunnerConfig();
		status.mode = getMode();
		status.intervalSec = cfg.intervalSec;

		// 사이클 실행
		status.state = 'running';
		status.cycleCount++;
		log(`\n━━━ 사이클 #${status.cycleCount} 시작 (${status.mode.toUpperCase()}) ━━━`);
		writeStatus();

		const cycle = await runCycle(cfg.pauseBetweenStepsSec);
		status.lastCycle = cycle;

		if (cycle.success) {
			status.successCount++;
			consecutiveErrors = 0;
			log(`━━━ 사이클 #${status.cycleCount} 완료 (${cycle.durationMs}ms) ━━━`);
		} else {
			status.failCount++;
			consecutiveErrors++;
			log(`━━━ 사이클 #${status.cycleCount} 실패 (${cycle.durationMs}ms) ━━━`);

			if (cfg.maxConsecutiveErrors > 0 && consecutiveErrors >= cfg.maxConsecutiveErrors) {
				log(`⛔ 연속 ${consecutiveErrors}회 실패 — 자동 정지`);
				status.state = 'error';
				status.stoppedAt = new Date().toISOString();
				status.stopReason = `${consecutiveErrors} consecutive errors`;
				writeStatus();
				break;
			}
		}

		// max_cycles 도달 시 종료
		if (onceMode || (cfg.maxCycles > 0 && status.cycleCount >= cfg.maxCycles)) {
			log(`✅ ${onceMode ? '1회 실행' : `${cfg.maxCycles}회`} 완료 — 종료`);
			status.state = 'stopped';
			status.stoppedAt = new Date().toISOString();
			status.stopReason = 'max_cycles reached';
			writeStatus();
			break;
		}

		// 다음 사이클 대기
		const waitSec = cycle.success ? cfg.intervalSec : cfg.cooldownOnErrorSec;
		const nextAt = new Date(Date.now() + waitSec * 1000);
		status.state = 'idle';
		status.nextCycleAt = nextAt.toISOString();
		writeStatus();

		log(`다음 사이클: ${nextAt.toLocaleTimeString('ko-KR', { hour12: false })} (${waitSec}초 후)`);

		// 대기 중에도 컨트롤 파일을 주기적으로 확인
		const waitEnd = Date.now() + waitSec * 1000;
		while (Date.now() < waitEnd) {
			await sleep(2000);
			const ctrlCmd = checkControlFile();
			if (ctrlCmd === 'stop') {
				log('🛑 대기 중 정지 명령 수신');
				status.state = 'stopped';
				status.stoppedAt = new Date().toISOString();
				status.stopReason = 'dashboard stop command';
				status.nextCycleAt = null;
				writeStatus();
				process.exit(0);
			}
			if (ctrlCmd === 'run-now') {
				log('⚡ 즉시 실행 명령 수신');
				break;
			}
			if (isKillSwitchActive()) break;
		}
	}

	log('Runner 종료');
}

main().catch(err => {
	log(`치명적 오류: ${err instanceof Error ? err.message : String(err)}`);
	status.state = 'error';
	status.stoppedAt = new Date().toISOString();
	status.stopReason = err instanceof Error ? err.message : String(err);
	writeStatus();
	process.exit(1);
});
