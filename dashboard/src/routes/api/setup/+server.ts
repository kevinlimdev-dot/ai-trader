import { json } from '@sveltejs/kit';
import { getSetupSummary } from '$lib/server/db';

export function GET() {
	return json(getSetupSummary());
}
