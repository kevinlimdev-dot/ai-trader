import { getDashboardData, getLatestSignals, getLatestPricesWithChange, getWalletAddresses, getLiveBalances, getAvailableCoins, getConfigSymbols, getHlLivePositions, syncPositionsWithHl } from '$lib/server/db';

export async function load() {
	const [walletAddresses, liveBalances, availableCoins, hlPositions] = await Promise.all([
		getWalletAddresses(),
		getLiveBalances(),
		getAvailableCoins(),
		getHlLivePositions(),
	]);

	// DB 동기화
	syncPositionsWithHl(hlPositions);

	return {
		dashboard: getDashboardData(hlPositions),
		signals: getLatestSignals(),
		livePrices: getLatestPricesWithChange(),
		walletAddresses,
		liveBalances,
		availableCoins,
		configSymbols: getConfigSymbols(),
		hlPositions,
	};
}
