import { json } from '@sveltejs/kit';
import { getLatestPricesWithChange } from '$lib/server/db';

export function GET() {
	return json({ prices: getLatestPricesWithChange(), ts: Date.now() });
}
