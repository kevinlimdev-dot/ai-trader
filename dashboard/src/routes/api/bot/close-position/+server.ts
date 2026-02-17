import { json } from '@sveltejs/kit';
import { resolve } from 'path';
import type { RequestHandler } from './$types';

const PROJECT_ROOT = resolve(process.cwd(), '..');

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { coin, side } = body;

	if (!coin || !side) {
		return json({ success: false, error: 'coin과 side가 필요합니다' }, { status: 400 });
	}

	try {
		const scriptPath = resolve(PROJECT_ROOT, 'skills/trader/scripts/execute-trade.ts');
		const proc = Bun.spawn(
			['bun', 'run', scriptPath, '--action', 'close-position', '--coin', coin, '--side', side],
			{
				cwd: PROJECT_ROOT,
				stdout: 'pipe',
				stderr: 'pipe',
				env: { ...process.env },
			}
		);

		const timeoutMs = 30_000;
		const timer = setTimeout(() => proc.kill(), timeoutMs);
		const exitCode = await proc.exited;
		clearTimeout(timer);

		const stdout = await new Response(proc.stdout).text();
		const stderr = await new Response(proc.stderr).text();

		if (exitCode !== 0) {
			return json({ success: false, error: stderr.trim() || stdout.trim() });
		}

		try {
			const lines = stdout.trim().split('\n');
			let jsonStr = '';
			let depth = 0;
			let inJson = false;
			for (const line of lines) {
				const trimmed = line.trim();
				if (!inJson && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
					inJson = true;
					jsonStr = '';
				}
				if (inJson) {
					jsonStr += line + '\n';
					for (const ch of trimmed) {
						if (ch === '{' || ch === '[') depth++;
						if (ch === '}' || ch === ']') depth--;
					}
					if (depth <= 0) {
						inJson = false;
						depth = 0;
					}
				}
			}
			const data = JSON.parse(jsonStr.trim());
			return json({ success: true, data });
		} catch {
			return json({ success: true, data: stdout.trim() });
		}
	} catch (err) {
		return json({ success: false, error: err instanceof Error ? err.message : String(err) });
	}
};
