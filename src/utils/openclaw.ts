/**
 * OpenClaw 연동 유틸리티
 *
 * OpenClaw 바이너리 경로 해결, 데몬 상태 확인, 에이전트 실행을 담당합니다.
 */
import { existsSync } from 'fs';
import { resolve } from 'path';

const KNOWN_PATHS = [
	resolve(process.env.HOME || '/Users/kevin', '.bun/bin/openclaw'),
	'/usr/local/bin/openclaw',
	'/opt/homebrew/bin/openclaw',
];

let resolvedPath: string | null | undefined = undefined;

/** OpenClaw 바이너리 전체 경로를 반환. 없으면 null */
export function getOpenClawPath(): string | null {
	if (resolvedPath !== undefined) return resolvedPath;

	for (const p of KNOWN_PATHS) {
		if (existsSync(p)) {
			resolvedPath = p;
			return resolvedPath;
		}
	}

	// PATH에서 찾기
	try {
		const proc = Bun.spawnSync(['which', 'openclaw'], { stdout: 'pipe', stderr: 'pipe' });
		if (proc.exitCode === 0) {
			const found = new TextDecoder().decode(proc.stdout).trim();
			if (found && existsSync(found)) {
				resolvedPath = found;
				return resolvedPath;
			}
		}
	} catch { /* ignore */ }

	resolvedPath = null;
	return null;
}

/** OpenClaw 데몬이 실행 중인지 확인 */
export function isDaemonRunning(): boolean {
	const bin = getOpenClawPath();
	if (!bin) return false;
	try {
		const proc = Bun.spawnSync([bin, 'daemon', 'status'], { stdout: 'pipe', stderr: 'pipe' });
		const output = new TextDecoder().decode(proc.stdout);
		return proc.exitCode === 0 && output.includes('loaded');
	} catch {
		return false;
	}
}

/** OpenClaw 데몬 자동 시작 (꺼져 있으면 시작 후 대기) */
export function startDaemon(): boolean {
	const bin = getOpenClawPath();
	if (!bin) return false;

	if (isDaemonRunning()) return true;

	try {
		const proc = Bun.spawnSync([bin, 'daemon', 'start'], {
			stdout: 'pipe',
			stderr: 'pipe',
			timeout: 15_000,
		});
		if (proc.exitCode !== 0) {
			const err = new TextDecoder().decode(proc.stderr).trim();
			console.error(`[OpenClaw] daemon start 실패: ${err}`);
			return false;
		}

		// 데몬이 뜰 때까지 최대 10초 대기
		for (let i = 0; i < 20; i++) {
			Bun.sleepSync(500);
			if (isDaemonRunning()) return true;
		}
		console.error('[OpenClaw] daemon start 후 10초 대기했으나 미응답');
		return false;
	} catch (err) {
		console.error('[OpenClaw] daemon start 예외:', err);
		return false;
	}
}

/** OpenClaw가 사용 가능한지 (바이너리 + 데몬) */
export function isOpenClawReady(): boolean {
	return getOpenClawPath() !== null && isDaemonRunning();
}

/** OpenClaw를 사용 가능하게 만든다 (데몬 자동 시작 포함) */
export function ensureOpenClawReady(): boolean {
	if (isOpenClawReady()) return true;
	if (!getOpenClawPath()) return false;
	return startDaemon();
}

export interface OpenClawResult {
	success: boolean;
	output: string;
	error?: string;
	durationMs: number;
	exitCode: number | null;
}

/** OpenClaw 에이전트에 메시지를 보내고 응답을 받음 */
export async function runOpenClawAgent(
	message: string,
	opts: {
		cwd?: string;
		timeoutMs?: number;
		outputFile?: string;
		agentId?: string;
		sessionId?: string;
	} = {},
): Promise<OpenClawResult> {
	const bin = getOpenClawPath();
	if (!bin) {
		return { success: false, output: '', error: 'OpenClaw not found', durationMs: 0, exitCode: null };
	}

	const start = Date.now();
	const timeoutMs = opts.timeoutMs ?? 300_000;
	const agentId = opts.agentId ?? 'main';

	try {
		const spawnOpts: Parameters<typeof Bun.spawn>[1] = {
			cwd: opts.cwd,
			stderr: 'pipe' as const,
			env: { ...process.env },
			stdin: 'ignore' as const,
		};

		if (opts.outputFile) {
			spawnOpts.stdout = Bun.file(opts.outputFile);
		} else {
			spawnOpts.stdout = 'pipe' as const;
		}

		const args = [bin, 'agent', '--agent', agentId, '--message', message];
		if (opts.sessionId) {
			args.push('--session-id', opts.sessionId);
		}

		const proc = Bun.spawn(args, spawnOpts);

		const timer = setTimeout(() => proc.kill(), timeoutMs);
		const exitCode = await proc.exited;
		clearTimeout(timer);

		const stderr = await new Response(proc.stderr).text();
		let stdout = '';
		if (!opts.outputFile) {
			stdout = await new Response(proc.stdout as ReadableStream).text();
		}
		const durationMs = Date.now() - start;

		if (exitCode !== 0) {
			return {
				success: false,
				output: stdout,
				error: stderr.trim() || `exit code ${exitCode}`,
				durationMs,
				exitCode,
			};
		}

		return { success: true, output: stdout, durationMs, exitCode };
	} catch (err) {
		return {
			success: false,
			output: '',
			error: err instanceof Error ? err.message : String(err),
			durationMs: Date.now() - start,
			exitCode: null,
		};
	}
}
