import { json } from '@sveltejs/kit';
import { toggleKillSwitch } from '$lib/server/bot';
import { isKillSwitchActive } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
	return json({ active: isKillSwitchActive() });
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const enabled = body.enabled as boolean;
	toggleKillSwitch(enabled);
	return json({ active: enabled });
};
