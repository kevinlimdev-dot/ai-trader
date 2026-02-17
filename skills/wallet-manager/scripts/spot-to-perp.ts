#!/usr/bin/env bun
/**
 * HyperLiquid Spot → Perps USDC 전송
 *
 * Usage:
 *   bun run skills/wallet-manager/scripts/spot-to-perp.ts              # Spot 전액 → Perp
 *   bun run skills/wallet-manager/scripts/spot-to-perp.ts --amount 500 # 500 USDC만
 */
import { HyperliquidService } from "../../../src/services/hyperliquid.service";

async function main() {
	const args = process.argv.slice(2);
	const amountIdx = args.indexOf("--amount");
	const requestedAmount = amountIdx >= 0 ? parseFloat(args[amountIdx + 1]) : undefined;

	const privateKey = process.env.HYPERLIQUID_PRIVATE_KEY;
	if (!privateKey) {
		console.error("HYPERLIQUID_PRIVATE_KEY not set");
		process.exit(1);
	}

	const hl = new HyperliquidService();
	await hl.initWallet(privateKey);

	// Spot 잔고 확인
	const spotBalance = await hl.getSpotBalance();
	console.log(`[Spot→Perp] Spot USDC 잔고: ${spotBalance}`);

	if (spotBalance <= 0) {
		console.log("[Spot→Perp] Spot에 USDC 잔고가 없습니다.");
		return;
	}

	// 전송 금액 결정
	let amount = requestedAmount ?? spotBalance;
	if (amount > spotBalance) {
		console.log(`[Spot→Perp] 요청 금액(${amount})이 잔고보다 큼 → 전액 전송`);
		amount = spotBalance;
	}

	if (amount < 1) {
		console.log("[Spot→Perp] 최소 1 USDC 이상 필요합니다.");
		return;
	}

	console.log(`[Spot→Perp] 전송 금액: ${amount} USDC`);

	// Spot → Perp 전송
	const result = await hl.spotToPerp(String(amount));
	console.log("[Spot→Perp] 결과:", JSON.stringify(result, null, 2));

	// 전송 후 잔고 확인
	const newSpot = await hl.getSpotBalance();
	const perpBalance = await hl.getBalance();
	console.log(`[Spot→Perp] ✅ 완료!`);
	console.log(`[Spot→Perp] Spot 잔고: ${newSpot} USDC`);
	console.log(`[Spot→Perp] Perp 잔고: ${perpBalance} USDC`);
}

main().catch((err) => {
	console.error("[Spot→Perp] Error:", err instanceof Error ? err.message : err);
	process.exit(1);
});
