import { json } from '@sveltejs/kit';
import { getRecentSnapshotsFromDb } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) => {
	const symbol = url.searchParams.get('symbol') || 'BTC';
	const limit = parseInt(url.searchParams.get('limit') || '100');

	const rows = getRecentSnapshotsFromDb(symbol, limit);
	const data = rows.reverse().map((r: any) => ({
		time: r.timestamp as string,
		binance: r.binance_mark_price as number,
		hyperliquid: r.hl_mid_price as number,
		spread: r.spread_percentage as number,
	}));

	return json({ symbol, data });
};
