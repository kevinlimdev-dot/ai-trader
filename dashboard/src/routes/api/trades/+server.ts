import { json } from '@sveltejs/kit';
import { getTrades } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) => {
	const page = parseInt(url.searchParams.get('page') || '1');
	const limit = parseInt(url.searchParams.get('limit') || '20');
	const symbol = url.searchParams.get('symbol') || undefined;
	const side = url.searchParams.get('side') || undefined;
	const status = url.searchParams.get('status') || undefined;

	return json(getTrades({ page, limit, symbol, side, status }));
};
