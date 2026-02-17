import { json } from '@sveltejs/kit';
import { resolve } from 'path';
import { existsSync, readFileSync } from 'fs';

const PROJECT_ROOT = resolve(process.cwd(), '..');
const ADJUST_FILE = resolve(PROJECT_ROOT, 'data/ai-adjustments.json');

export async function GET() {
	if (!existsSync(ADJUST_FILE)) {
		return json(null);
	}
	try {
		const raw = readFileSync(ADJUST_FILE, 'utf-8');
		const data = JSON.parse(raw);
		return json(data);
	} catch {
		return json(null);
	}
}
