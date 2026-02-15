import { getDashboardData, getLatestSignals, getLatestPricesWithChange, getWalletAddresses, getLiveBalances, getAvailableCoins } from '$lib/server/db';

export async function load() {
	const [walletAddresses, liveBalances, availableCoins] = await Promise.all([
		getWalletAddresses(),
		getLiveBalances(),
		getAvailableCoins(),
	]);

	return {
		dashboard: getDashboardData(),
		signals: getLatestSignals(),
		livePrices: getLatestPricesWithChange(),
		walletAddresses,
		liveBalances,
		availableCoins,
	};
}
