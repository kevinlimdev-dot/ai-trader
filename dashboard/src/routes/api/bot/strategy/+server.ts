import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolve } from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { parse, stringify } from 'yaml';

const PROJECT_ROOT = resolve(process.cwd(), '..');

function getConfigPath(): string {
	return resolve(PROJECT_ROOT, 'config.yaml');
}

function getCurrentStrategy(): string {
	const configPath = getConfigPath();
	if (!existsSync(configPath)) return 'balanced';
	const raw = readFileSync(configPath, 'utf-8');
	const config = parse(raw);
	return config?.general?.strategy || 'balanced';
}

export const GET: RequestHandler = () => {
	return json({ strategy: getCurrentStrategy() });
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const newStrategy = body.strategy as string;
	const validStrategies = ['conservative', 'balanced', 'aggressive'];

	if (!validStrategies.includes(newStrategy)) {
		return json(
			{ success: false, error: `Invalid strategy. Must be one of: ${validStrategies.join(', ')}` },
			{ status: 400 }
		);
	}

	const configPath = getConfigPath();
	if (!existsSync(configPath)) {
		return json({ success: false, error: 'config.yaml not found' }, { status: 500 });
	}

	try {
		const raw = readFileSync(configPath, 'utf-8');
		const config = parse(raw);
		config.general.strategy = newStrategy;
		writeFileSync(configPath, stringify(config), 'utf-8');
		return json({ success: true, strategy: newStrategy });
	} catch (e) {
		return json(
			{ success: false, error: e instanceof Error ? e.message : String(e) },
			{ status: 500 }
		);
	}
};
