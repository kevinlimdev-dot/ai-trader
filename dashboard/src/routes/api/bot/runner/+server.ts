import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolve } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';

const PROJECT_ROOT = resolve(process.cwd(), '..');
const STATUS_FILE = '/tmp/ai-trader-runner-status.json';
const CONTROL_FILE = '/tmp/ai-trader-runner-control.json';

interface RunnerStatus {
	state: 'running' | 'idle' | 'stopped' | 'error';
	pid: number;
	startedAt: string;
	cycleCount: number;
	successCount: number;
	failCount: number;
	lastCycle: any;
	nextCycleAt: string | null;
	intervalSec: number;
	mode: string;
	updatedAt: string;
	stoppedAt?: string;
	stopReason?: string;
}

function readStatus(): RunnerStatus | null {
	if (!existsSync(STATUS_FILE)) return null;
	try {
		const raw = readFileSync(STATUS_FILE, 'utf-8');
		const data = JSON.parse(raw) as RunnerStatus;

		// 프로세스가 실제로 살아있는지 확인
		if (data.state === 'running' || data.state === 'idle') {
			try {
				process.kill(data.pid, 0);
			} catch {
				// 프로세스 죽음 — 상태 보정
				data.state = 'stopped';
				data.stopReason = 'process not found';
			}
		}

		return data;
	} catch {
		return null;
	}
}

function sendControl(command: string) {
	writeFileSync(CONTROL_FILE, JSON.stringify({ command, timestamp: new Date().toISOString() }));
}

/** GET: 러너 상태 조회 */
export const GET: RequestHandler = async () => {
	const status = readStatus();
	if (!status) {
		return json({
			state: 'stopped',
			pid: 0,
			cycleCount: 0,
			successCount: 0,
			failCount: 0,
			lastCycle: null,
			nextCycleAt: null,
			intervalSec: 0,
			mode: 'unknown',
			updatedAt: null,
		});
	}
	return json(status);
};

/** POST: 러너 시작/정지/즉시실행 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const action = body.action as string;

	if (action === 'start') {
		// 이미 실행 중인지 확인
		const current = readStatus();
		if (current && (current.state === 'running' || current.state === 'idle')) {
			try {
				process.kill(current.pid, 0);
				return json({ success: false, error: 'Runner already running', status: current });
			} catch {
				// 프로세스 죽어있으면 새로 시작
			}
		}

		// Runner 프로세스를 백그라운드로 시작
		const runnerPath = resolve(PROJECT_ROOT, 'src', 'runner.ts');
		const logPath = resolve(PROJECT_ROOT, 'data', 'runner.log');

		try {
			const proc = Bun.spawn(['bun', 'run', runnerPath], {
				cwd: PROJECT_ROOT,
				stdout: Bun.file(logPath),
				stderr: Bun.file(logPath),
				env: { ...process.env },
				stdin: 'ignore',
			});

			// 잠시 대기 후 상태 확인
			await new Promise(r => setTimeout(r, 1500));
			const status = readStatus();

			return json({
				success: true,
				pid: proc.pid,
				status,
			});
		} catch (err) {
			return json({
				success: false,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	if (action === 'stop') {
		const current = readStatus();
		if (!current || (current.state !== 'running' && current.state !== 'idle')) {
			return json({ success: true, message: 'Runner not running' });
		}

		// 컨트롤 파일로 graceful stop 요청
		sendControl('stop');

		// 최대 5초 대기
		for (let i = 0; i < 10; i++) {
			await new Promise(r => setTimeout(r, 500));
			const updated = readStatus();
			if (updated?.state === 'stopped') {
				return json({ success: true, status: updated });
			}
		}

		// Graceful stop 실패 시 SIGTERM
		try {
			process.kill(current.pid, 'SIGTERM');
		} catch {}

		return json({ success: true, message: 'Stop signal sent' });
	}

	if (action === 'run-now') {
		const current = readStatus();
		if (!current || (current.state !== 'idle')) {
			return json({ success: false, error: 'Runner not in idle state' });
		}
		sendControl('run-now');
		return json({ success: true, message: 'Run-now signal sent' });
	}

	return json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
};
