import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolve } from 'path';
import { existsSync, readFileSync, statSync } from 'fs';

const PROJECT_ROOT = resolve(process.cwd(), '..');

export const GET: RequestHandler = async ({ url }) => {
	const lines = parseInt(url.searchParams.get('lines') ?? '50', 10);
	const logPath = resolve(PROJECT_ROOT, 'data', 'runner.log');

	if (!existsSync(logPath)) {
		return json({ lines: [], size: 0, modified: null });
	}

	try {
		const stat = statSync(logPath);
		const raw = readFileSync(logPath, 'utf-8');
		const allLines = raw.split('\n').filter(l => l.trim());
		const tail = allLines.slice(-lines);

		return json({
			lines: tail,
			size: stat.size,
			modified: stat.mtime.toISOString(),
			totalLines: allLines.length,
		});
	} catch {
		return json({ lines: [], size: 0, modified: null });
	}
};
