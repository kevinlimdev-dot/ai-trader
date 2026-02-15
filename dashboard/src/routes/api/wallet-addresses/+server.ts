import { json } from '@sveltejs/kit';
import { getWalletAddresses } from '$lib/server/db';

export async function GET() {
	return json(await getWalletAddresses());
}
