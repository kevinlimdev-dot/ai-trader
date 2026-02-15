import { json } from '@sveltejs/kit';
import { getDashboardData } from '$lib/server/db';

export function GET() {
	return json(getDashboardData());
}
