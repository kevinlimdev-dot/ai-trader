import { json } from '@sveltejs/kit';
import { getOpenPositions } from '$lib/server/db';

export function GET() {
	return json({ positions: getOpenPositions() });
}
