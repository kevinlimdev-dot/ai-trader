import { json } from '@sveltejs/kit';
import { runScript } from '$lib/server/bot';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const reason = body.reason || 'dashboard';
	const result = await runScript('close-all', ['--reason', reason]);
	return json(result);
};
