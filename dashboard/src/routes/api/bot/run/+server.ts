import { json } from '@sveltejs/kit';
import { runScript } from '$lib/server/bot';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const script = body.script as string;
	const args = body.args as string[] || [];

	const validScripts = ['collect', 'analyze', 'trade', 'monitor', 'positions', 'close-all', 'emergency', 'daily-summary', 'balance', 'daily-report', 'auto-rebalance', 'pipeline'];
	if (!validScripts.includes(script)) {
		return json({ success: false, error: `Invalid script: ${script}` }, { status: 400 });
	}

	const result = await runScript(script as Parameters<typeof runScript>[0], args);
	return json(result);
};
