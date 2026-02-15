import { json } from '@sveltejs/kit';
import { getLiveBalances } from '$lib/server/db';

export async function GET() {
	const balances = await getLiveBalances();
	return json(balances);
}
