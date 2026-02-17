import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolve } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';

const PROJECT_ROOT = resolve(process.cwd(), '..');
const MONITOR_STATUS = '/tmp/ai-trader-monitor-status.json';
const MONITOR_CONTROL = '/tmp/ai-trader-monitor-control.json';

export const GET: RequestHandler = async () => {
	try {
		if (!existsSync(MONITOR_STATUS)) {
			return json({ state: 'stopped', openPositions: 0 });
		}
		const raw = readFileSync(MONITOR_STATUS, 'utf-8');
		const status = JSON.parse(raw);

		// PID가 살아있는지 확인
		if (status.state === 'running' && status.pid) {
			try {
				process.kill(status.pid, 0);
			} catch {
				status.state = 'stopped';
			}
		}

		return json(status);
	} catch {
		return json({ state: 'stopped', openPositions: 0 });
	}
};

export const POST: RequestHandler = async ({ request }) => {
	const { action } = await request.json().catch(() => ({ action: '' }));

	if (action === 'start') {
		const proc = Bun.spawn(
			['bun', 'run', resolve(PROJECT_ROOT, 'src/position-monitor.ts')],
			{ cwd: PROJECT_ROOT, env: { ...process.env }, stdout: 'ignore', stderr: 'ignore' }
		);
		return json({ status: 'started', pid: proc.pid });
	}

	if (action === 'stop') {
		writeFileSync(MONITOR_CONTROL, JSON.stringify({ command: 'stop' }));
		return json({ status: 'stop_sent' });
	}

	return json({ status: 'error', error: `Unknown action: ${action}` }, { status: 400 });
};
