import { getMode, isKillSwitchActive, getApiErrorCount, getConfig, getSetupSummary } from '$lib/server/db';
import { stringify } from 'yaml';

export function load() {
	const config = getConfig();
	let configYaml: string;
	try {
		configYaml = stringify(config, { lineWidth: 120 });
	} catch {
		configYaml = JSON.stringify(config, null, 2);
	}

	return {
		mode: getMode(),
		killSwitch: isKillSwitchActive(),
		apiErrorCount: getApiErrorCount(),
		configYaml,
		setup: getSetupSummary(),
	};
}
