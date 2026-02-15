import { getWalletData, getWalletAddresses } from '$lib/server/db';

export async function load() {
	return {
		wallet: getWalletData(),
		walletAddresses: await getWalletAddresses(),
	};
}
