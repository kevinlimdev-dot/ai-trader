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
import { isOpenClawReady, runOpenClawAgent, getOpenClawPath } from './utils/openclaw';

const MONITOR_STATUS_FILE = '/tmp/ai-trader-monitor-status.json';

const PROJECT_ROOT = resolve(import.meta.dirname, '..');
const STATUS_FILE = '/tmp/ai-trader-runner-status.json';
const CONTROL_FILE = '/tmp/ai-trader-runner-control.json';

// ─── Types ───

interface StepResult {
	success: boolean;
	durationMs: number;
	error?: string;
	output?: string;
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
	{ id: 'sentiment', label: '시장 심리 수집', file: 'skills/ai-decision/scripts/collect-sentiment.ts', args: [], critical: false },
	{ id: 'summarize', label: 'AI 판단 요약', file: 'skills/ai-decision/scripts/summarize.ts', args: [], critical: false },
	{ id: 'rebalance', label: '자금 리밸런싱', file: 'skills/wallet-manager/scripts/manage-wallet.ts', args: ['--action', 'auto-rebalance'], critical: false },
	{ id: 'trade', label: '거래 실행', file: 'skills/trader/scripts/execute-trade.ts', args: [], critical: false },
];

// ─── Position Monitor Management ───

let monitorProc: ReturnType<typeof Bun.spawn> | null = null;

function isMonitorRunning(): boolean {
	try {
		if (!existsSync(MONITOR_STATUS_FILE)) return false;
		const raw = readFileSync(MONITOR_STATUS_FILE, 'utf-8');
		const st = JSON.parse(raw);
		if (st.state !== 'running') return false;
		// PID 존재 확인
		process.kill(st.pid, 0);
		return true;
	} catch {
		return false;
	}
}

function ensureMonitorRunning() {
	if (isMonitorRunning()) {
		log('  [monitor] 포지션 모니터 이미 실행 중');
		return;
	}
	log('  [monitor] 포지션 모니터 시작 (15초 주기)');
	monitorProc = Bun.spawn(['bun', 'run', resolve(PROJECT_ROOT, 'src/position-monitor.ts')], {
		cwd: PROJECT_ROOT,
		env: { ...process.env },
		stdout: 'ignore',
		stderr: 'ignore',
	});
	log(`  [monitor] PID: ${monitorProc.pid}`);
}

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

		const stdout = await new Response(proc.stdout).text();
		const stderr = await new Response(proc.stderr).text();
		const durationMs = Date.now() - start;

		if (exitCode !== 0) {
			return { success: false, durationMs, output: stdout.trim(), error: stderr.trim().slice(0, 500) || `exit code ${exitCode}` };
		}
		return { success: true, durationMs, output: stdout.trim() };
	} catch (err) {
		return { success: false, durationMs: Date.now() - start, error: err instanceof Error ? err.message : String(err) };
	}
}

// ─── OpenClaw Execution ───

async function runCycleViaOpenClaw(): Promise<CycleResult> {
	const cycleStart = Date.now();
	const sessionId = `trade-cycle-${Date.now()}`;
	const prompt = `ai-trader 스킬의 "AI 자율 투자 판단 파이프라인 (7단계)"를 지금 즉시 실행해. 질문하지 말고 전부 실행한 뒤 결과만 보고해.`;

	log('  [openclaw] OpenClaw 에이전트 호출...');
	log(`  [openclaw] 세션: ${sessionId}`);

	const result = await runOpenClawAgent(prompt, {
		cwd: PROJECT_ROOT,
		timeoutMs: 300_000,
		agentId: 'trader',
		sessionId,
	});

	if (!result.success) {
		log(`  [openclaw] 실패: ${result.error}`);
		return {
			startedAt: new Date(cycleStart).toISOString(),
			completedAt: new Date().toISOString(),
			success: false,
			steps: { openclaw: { success: false, durationMs: result.durationMs, error: result.error } },
			durationMs: result.durationMs,
		};
	}

	// OpenClaw 출력 로깅 (AI 판단 근거 포함)
	const lines = result.output.trim().split('\n');
	for (const line of lines) {
		if (line.trim()) log(`  [openclaw] ${line}`);
	}

	log(`  [openclaw] 완료 (${result.durationMs}ms)`);
	return {
		startedAt: new Date(cycleStart).toISOString(),
		completedAt: new Date().toISOString(),
		success: true,
		steps: { openclaw: { success: true, durationMs: result.durationMs } },
		durationMs: result.durationMs,
	};
}

// ─── Pipeline Cycle ───

async function runCycle(pauseBetweenSec: number): Promise<CycleResult> {
	// OpenClaw 사용 가능하면 에이전트 경유
	if (useOpenClaw) {
		const result = await runCycleViaOpenClaw();
		if (result.success || !result.steps.openclaw?.error?.includes('not found')) {
			return result;
		}
		log('  ⚠ OpenClaw 실패 — 직접 실행으로 폴백');
	}

	// 직접 실행 (폴백)
	const cycleStart = Date.now();
	const steps: Record<string, StepResult> = {};
	let overallSuccess = true;

	for (const step of SCRIPTS) {
		log(`  [${step.id}] ${step.label} 시작...`);
		const result = await runStep(step);
		steps[step.id] = result;

		if (result.success) {
			log(`  [${step.id}] 완료 (${result.durationMs}ms)`);
			// 스텝 출력에서 핵심 거래 정보 로깅
			if (result.output) {
				logStepOutput(step.id, result.output);
			}
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

function logStepOutput(stepId: string, output: string) {
	try {
		const data = JSON.parse(output);
		if (stepId === 'analyze' && data.signals) {
			const active = data.signals.filter((s: any) => s.action !== 'HOLD');
			const holdCount = data.signals.length - active.length;
			if (active.length > 0) {
				for (const s of active) {
					log(`    📊 ${s.symbol} → ${s.action} (score: ${s.composite_score}, conf: ${s.confidence})`);
				}
			}
			log(`    📊 분석: ${data.analyzed}개 코인 (${active.length} 시그널, ${holdCount} HOLD)`);
		} else if (stepId === 'trade' && data.trades) {
			for (const t of data.trades) {
				if (t.action === 'HOLD') continue;
				if (t.skipped) {
					log(`    💤 ${t.symbol} ${t.action} 스킵: ${t.reason}`);
				} else if (t.error) {
					log(`    ❌ ${t.symbol} ${t.action} 에러: ${t.error}`);
				} else if (t.status === 'insufficient_balance') {
					log(`    💰 ${t.symbol} 잔고 부족 (필요: $${t.needed}, 보유: $${t.current_balance})`);
				} else {
					const mode = t.mode === 'paper' ? '[PAPER]' : '[LIVE]';
					log(`    🔥 ${mode} ${t.symbol} ${t.action} @ $${t.entry_price} (size: ${t.size}, lev: ${t.leverage}x, SL: $${t.stop_loss}, TP: $${t.take_profit})`);
				}
			}
		} else if (stepId === 'rebalance') {
			if (data.status === 'rebalanced') {
				log(`    💱 리밸런싱: ${data.direction} $${data.amount}`);
			} else if (data.status === 'balanced') {
				log(`    ✅ 잔고 균형 OK`);
			}
		} else if (stepId === 'collect') {
			if (data.collected) {
				log(`    📡 ${data.collected}개 코인 가격 수집 완료`);
			}
		}
	} catch {
		// JSON 파싱 실패 시 첫 줄만 출력
		const firstLine = output.split('\n')[0]?.trim();
		if (firstLine && firstLine.length < 200) {
			log(`    → ${firstLine}`);
		}
	}
}

function sleep(ms: number) {
	return new Promise(r => setTimeout(r, ms));
}

// ─── Main Loop ───

// OpenClaw 사용 여부 (시작 시 체크)
let useOpenClaw = false;

async function main() {
	const onceMode = process.argv.includes('--once');
	const directMode = process.argv.includes('--direct');
	const runnerConfig = getRunnerConfig();
	const mode = getMode();

	// OpenClaw 사용 가능 여부 확인
	if (!directMode) {
		const clawPath = getOpenClawPath();
		if (clawPath) {
			const daemonOk = isOpenClawReady();
			useOpenClaw = daemonOk;
			if (!daemonOk) {
				log(`⚠ OpenClaw 바이너리 발견 (${clawPath}) 하지만 데몬 미실행`);
			}
		}
	}

	log('═══════════════════════════════════════════');
	log(`AI Trader Runner 시작`);
	log(`  모드: ${mode.toUpperCase()}`);
	log(`  실행: ${useOpenClaw ? 'OpenClaw 에이전트 (' + getOpenClawPath() + ')' : '직접 실행 (Bun.spawn)'}`);
	log(`  간격: ${runnerConfig.intervalSec}초`);
	log(`  최대 사이클: ${runnerConfig.maxCycles || '무한'}`);
	log(`  PID: ${process.pid}`);
	if (onceMode) log(`  ⚡ 1회 실행 모드`);
	if (directMode) log(`  ⚠ 직접 실행 모드 (OpenClaw 비활성화)`);
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
			// 거래 실행 후 포지션 모니터 자동 시작
			ensureMonitorRunning();
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

		// max_cycles 도달 시 종료 (1회 실행이어도 모니터는 백그라운드 유지)
		if (onceMode || (cfg.maxCycles > 0 && status.cycleCount >= cfg.maxCycles)) {
			ensureMonitorRunning();
			log(`✅ ${onceMode ? '1회 실행' : `${cfg.maxCycles}회`} 완료 — 종료 (포지션 모니터는 계속 실행)`);
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
