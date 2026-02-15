import { getSetupSummary, getMode, getWalletAddresses } from '$lib/server/db';

export async function load() {
	return {
		setup: getSetupSummary(),
		mode: getMode(),
		walletAddresses: await getWalletAddresses(),
	};
}
