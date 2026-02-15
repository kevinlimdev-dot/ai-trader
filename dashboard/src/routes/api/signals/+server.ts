import { json } from '@sveltejs/kit';
import { getLatestSignals, getLatestSnapshots } from '$lib/server/db';

export function GET() {
	return json({ signals: getLatestSignals(), snapshots: getLatestSnapshots() });
}
