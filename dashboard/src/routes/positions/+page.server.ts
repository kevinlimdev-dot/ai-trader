import { getOpenPositions, getMode } from '$lib/server/db';

export function load() {
	return {
		positions: getOpenPositions(),
		mode: getMode(),
	};
}
