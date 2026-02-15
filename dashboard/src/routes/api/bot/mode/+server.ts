import { json } from '@sveltejs/kit';
import { getMode, setMode } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
	return json({ mode: getMode() });
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const newMode = body.mode as string;

	if (newMode !== 'paper' && newMode !== 'live') {
		return json({ success: false, error: 'Invalid mode. Must be "paper" or "live".' }, { status: 400 });
	}

	const result = setMode(newMode);
	return json(result);
};
