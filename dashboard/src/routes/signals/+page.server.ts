import { getLatestSignals, getLatestSnapshots } from '$lib/server/db';

export function load() {
	return {
		signals: getLatestSignals(),
		snapshots: getLatestSnapshots(),
	};
}
