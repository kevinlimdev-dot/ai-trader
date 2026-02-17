import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolve } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';

const PROJECT_ROOT = resolve(process.cwd(), '..');
const OUTPUT_FILE = '/tmp/ai-trader-openclaw-output.txt';
const STATUS_FILE = '/tmp/ai-trader-openclaw-status.json';

// OpenClaw 바이너리 경로 해결
const KNOWN_PATHS = [
	resolve(process.env.HOME || '/Users/kevin', '.bun/bin/openclaw'),
	'/usr/local/bin/openclaw',
	'/opt/homebrew/bin/openclaw',
];

function findOpenClaw(): string | null {
	for (const p of KNOWN_PATHS) {
		if (existsSync(p)) return p;
	}
	try {
		const proc = Bun.spawnSync(['which', 'openclaw'], { stdout: 'pipe', stderr: 'pipe' });
		if (proc.exitCode === 0) {
			const found = new TextDecoder().decode(proc.stdout).trim();
			if (found && existsSync(found)) return found;
		}
	} catch { /* ignore */ }
	return null;
}

function checkDaemon(bin: string): boolean {
	try {
		const proc = Bun.spawnSync([bin, 'daemon', 'status'], { stdout: 'pipe', stderr: 'pipe' });
		const output = new TextDecoder().decode(proc.stdout);
		return proc.exitCode === 0 && output.includes('loaded');
	} catch {
		return false;
	}
}

interface OpenClawStatus {
	state: 'idle' | 'running' | 'done' | 'failed';
	pid?: number;
	action?: string;
	prompt?: string;
	startedAt?: string;
	completedAt?: string;
	exitCode?: number;
}

function readStatus(): OpenClawStatus {
	if (!existsSync(STATUS_FILE)) return { state: 'idle' };
	try {
		const raw: OpenClawStatus = JSON.parse(readFileSync(STATUS_FILE, 'utf-8'));
		if (raw.state === 'running' && raw.pid) {
			try {
				process.kill(raw.pid, 0);
			} catch {
				raw.state = 'failed';
				raw.completedAt = new Date().toISOString();
				writeFileSync(STATUS_FILE, JSON.stringify(raw));
			}
		}
		return raw;
	} catch {
		return { state: 'idle' };
	}
}

function readOutput(): string {
	if (!existsSync(OUTPUT_FILE)) return '';
	try {
		return readFileSync(OUTPUT_FILE, 'utf-8');
	} catch {
		return '';
	}
}

/** GET: OpenClaw 상태 + 출력 + 연결 상태 */
export const GET: RequestHandler = async () => {
	const bin = findOpenClaw();
	const status = readStatus();
	const output = readOutput();

	return json({
		...status,
		output,
		openclaw: {
			installed: !!bin,
			path: bin,
			daemonRunning: bin ? checkDaemon(bin) : false,
		},
	});
};

/** POST: OpenClaw 에이전트를 통해 파이프라인 실행 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const action = (body.action as string) || 'pipeline';

	// OpenClaw 바이너리 확인
	const bin = findOpenClaw();
	if (!bin) {
		return json({ success: false, error: 'OpenClaw not installed. Run: bun add -g openclaw' });
	}

	// 데몬 확인 — 꺼져있으면 자동 시작
	if (!checkDaemon(bin)) {
		try {
			const startProc = Bun.spawnSync([bin, 'daemon', 'start'], {
				stdout: 'pipe', stderr: 'pipe', timeout: 15_000,
			});
			if (startProc.exitCode !== 0) {
				return json({ success: false, error: 'OpenClaw daemon 자동 시작 실패' });
			}
			// 데몬 준비 대기 (최대 10초)
			let ready = false;
			for (let i = 0; i < 20; i++) {
				Bun.sleepSync(500);
				if (checkDaemon(bin)) { ready = true; break; }
			}
			if (!ready) {
				return json({ success: false, error: 'OpenClaw daemon 시작 후 응답 없음' });
			}
		} catch {
			return json({ success: false, error: 'OpenClaw daemon 시작 중 예외 발생' });
		}
	}

	// 이미 실행 중인지 확인
	const current = readStatus();
	if (current.state === 'running') {
		return json({ success: false, error: 'OpenClaw agent already running' });
	}

	// 이전 출력 파일 초기화
	writeFileSync(OUTPUT_FILE, '');

	let proc: ReturnType<typeof Bun.spawn>;

	if (action === 'pipeline') {
		// 하이브리드 파이프라인: Runner --once 사용 (1-4/6-7 직접 실행, 5단계만 OpenClaw AI 판단)
		proc = Bun.spawn(['bun', 'run', resolve(PROJECT_ROOT, 'src/runner.ts'), '--once'], {
			cwd: PROJECT_ROOT,
			stdout: Bun.file(OUTPUT_FILE),
			stderr: Bun.file(OUTPUT_FILE),
			env: { ...process.env },
			stdin: 'ignore',
		});
	} else {
		let prompt: string;
		switch (action) {
			case 'status':
				prompt = '현재 투자 현황 알려줘. 포지션, 잔고, 오늘 PnL, 전략 상태 포함해서 보고해줘.';
				break;
			default:
				prompt = action;
		}

		const sessionId = `dashboard-${Date.now()}`;
		proc = Bun.spawn([bin, 'agent', '--agent', 'main', '--session-id', sessionId, '--message', prompt], {
			cwd: PROJECT_ROOT,
			stdout: Bun.file(OUTPUT_FILE),
			stderr: Bun.file(OUTPUT_FILE),
			env: { ...process.env },
			stdin: 'ignore',
		});
	}

	try {
		const statusData: OpenClawStatus = {
			state: 'running',
			pid: proc.pid,
			action,
			prompt: action === 'pipeline' ? '하이브리드 파이프라인 (Runner --once)' : action,
			startedAt: new Date().toISOString(),
		};
		writeFileSync(STATUS_FILE, JSON.stringify(statusData));

		// 완료 시 상태 업데이트 (백그라운드)
		proc.exited.then((exitCode) => {
			try {
				const existing: OpenClawStatus = JSON.parse(readFileSync(STATUS_FILE, 'utf-8'));
				existing.state = exitCode === 0 ? 'done' : 'failed';
				existing.exitCode = exitCode ?? undefined;
				existing.completedAt = new Date().toISOString();
				writeFileSync(STATUS_FILE, JSON.stringify(existing));
			} catch { /* ignore */ }
		});

		return json({ success: true, pid: proc.pid });
	} catch (err) {
		return json({
			success: false,
			error: err instanceof Error ? err.message : String(err),
		});
	}
};
