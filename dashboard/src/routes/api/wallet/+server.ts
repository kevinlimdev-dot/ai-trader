import { json } from '@sveltejs/kit';
import { getWalletData } from '$lib/server/db';

export function GET() {
	return json(getWalletData());
}
