import { getTrades } from '$lib/server/db';

export function load({ url }) {
	const page = parseInt(url.searchParams.get('page') || '1');
	const limit = parseInt(url.searchParams.get('limit') || '20');
	const symbol = url.searchParams.get('symbol') || undefined;
	const side = url.searchParams.get('side') || undefined;
	const status = url.searchParams.get('status') || undefined;

	return { tradesData: getTrades({ page, limit, symbol, side, status }), filters: { symbol, side, status } };
}
