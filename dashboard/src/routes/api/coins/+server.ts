import { json } from '@sveltejs/kit';
import { getAvailableCoins } from '$lib/server/db';

export async function GET() {
	const coins = await getAvailableCoins();
	return json({ coins, total: coins.length });
}
