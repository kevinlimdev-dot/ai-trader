#!/usr/bin/env bun
/**
 * Arbitrum → HyperLiquid USDC 입금 스크립트
 *
 * HyperLiquid Bridge2 컨트랙트에 USDC를 전송하여 자동 입금합니다.
 * 최소 입금: 5 USDC, 처리 시간: ~1분
 *
 * Usage:
 *   bun run skills/wallet-manager/scripts/deposit-to-hl.ts                 # 전액 입금
 *   bun run skills/wallet-manager/scripts/deposit-to-hl.ts --amount 500    # 500 USDC 입금
 *   bun run skills/wallet-manager/scripts/deposit-to-hl.ts --dry-run       # 시뮬레이션만
 */
import {
	createPublicClient,
	createWalletClient,
	http,
	parseUnits,
	formatUnits,
	encodeFunctionData,
	type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum } from "viem/chains";

// ─── Constants ───

const USDC_ADDRESS = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as const;
const HL_BRIDGE2 = "0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7" as const;
const MIN_DEPOSIT = 5n * 10n ** 6n; // 5 USDC (6 decimals)
const USDC_DECIMALS = 6;

const ERC20_ABI = [
	{
		name: "balanceOf",
		type: "function",
		stateMutability: "view",
		inputs: [{ name: "account", type: "address" }],
		outputs: [{ name: "", type: "uint256" }],
	},
	{
		name: "transfer",
		type: "function",
		stateMutability: "nonpayable",
		inputs: [
			{ name: "to", type: "address" },
			{ name: "amount", type: "uint256" },
		],
		outputs: [{ name: "", type: "bool" }],
	},
	{
		name: "allowance",
		type: "function",
		stateMutability: "view",
		inputs: [
			{ name: "owner", type: "address" },
			{ name: "spender", type: "address" },
		],
		outputs: [{ name: "", type: "uint256" }],
	},
	{
		name: "approve",
		type: "function",
		stateMutability: "nonpayable",
		inputs: [
			{ name: "spender", type: "address" },
			{ name: "amount", type: "uint256" },
		],
		outputs: [{ name: "", type: "bool" }],
	},
] as const;

// ─── CLI Parsing ───

function parseArgs() {
	const args = process.argv.slice(2);
	const amountIdx = args.indexOf("--amount");
	const dryRun = args.includes("--dry-run");
	return {
		amount: amountIdx >= 0 ? parseFloat(args[amountIdx + 1]) : undefined,
		dryRun,
	};
}

// ─── Main ───

async function main() {
	const { amount: requestedAmount, dryRun } = parseArgs();

	// Private key 확인
	const privateKey = process.env.HYPERLIQUID_PRIVATE_KEY;
	if (!privateKey) {
		console.error(JSON.stringify({ status: "error", error: "HYPERLIQUID_PRIVATE_KEY not set" }));
		process.exit(1);
	}

	const formattedKey = (privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as Hex;
	const account = privateKeyToAccount(formattedKey);

	console.log(`[Deposit] 지갑: ${account.address}`);
	console.log(`[Deposit] 네트워크: Arbitrum One`);
	console.log(`[Deposit] 브릿지: ${HL_BRIDGE2}`);
	if (dryRun) console.log(`[Deposit] ⚠ DRY RUN 모드 — 실제 전송 없음`);

	// Arbitrum 클라이언트 생성
	const publicClient = createPublicClient({
		chain: arbitrum,
		transport: http(),
	});

	const walletClient = createWalletClient({
		account,
		chain: arbitrum,
		transport: http(),
	});

	// 1. ETH 잔고 확인 (가스비)
	const ethBalance = await publicClient.getBalance({ address: account.address });
	const ethFormatted = formatUnits(ethBalance, 18);
	console.log(`[Deposit] ETH 잔고: ${ethFormatted} ETH (가스비)`);

	if (ethBalance < parseUnits("0.001", 18)) {
		console.error(JSON.stringify({
			status: "error",
			error: "ETH 잔고 부족 (가스비). 최소 0.001 ETH 필요",
			ethBalance: ethFormatted,
		}));
		process.exit(1);
	}

	// 2. USDC 잔고 확인
	const usdcBalance = await publicClient.readContract({
		address: USDC_ADDRESS,
		abi: ERC20_ABI,
		functionName: "balanceOf",
		args: [account.address],
	});

	const usdcFormatted = formatUnits(usdcBalance, USDC_DECIMALS);
	console.log(`[Deposit] USDC 잔고: ${usdcFormatted} USDC`);

	if (usdcBalance < MIN_DEPOSIT) {
		console.error(JSON.stringify({
			status: "error",
			error: `USDC 잔고 부족. 최소 5 USDC 필요 (현재: ${usdcFormatted})`,
			usdcBalance: usdcFormatted,
		}));
		process.exit(1);
	}

	// 3. 입금 금액 결정
	let depositAmount: bigint;
	if (requestedAmount) {
		depositAmount = parseUnits(String(requestedAmount), USDC_DECIMALS);
		if (depositAmount > usdcBalance) {
			console.log(`[Deposit] 요청 금액(${requestedAmount})이 잔고보다 큼 → 전액 입금`);
			depositAmount = usdcBalance;
		}
	} else {
		depositAmount = usdcBalance;
	}

	if (depositAmount < MIN_DEPOSIT) {
		console.error(JSON.stringify({
			status: "error",
			error: `입금 금액이 최소 기준 미달 (${formatUnits(depositAmount, USDC_DECIMALS)} < 5 USDC)`,
		}));
		process.exit(1);
	}

	const depositFormatted = formatUnits(depositAmount, USDC_DECIMALS);
	console.log(`[Deposit] 입금 금액: ${depositFormatted} USDC`);

	if (dryRun) {
		console.log(JSON.stringify({
			status: "dry_run",
			from: account.address,
			to: HL_BRIDGE2,
			amount: depositFormatted,
			usdcBalance: usdcFormatted,
			ethBalance: ethFormatted,
		}, null, 2));
		return;
	}

	// 4. USDC를 HyperLiquid Bridge2로 전송
	console.log(`[Deposit] USDC 전송 중... (${depositFormatted} USDC → Bridge2)`);

	try {
		const txHash = await walletClient.writeContract({
			address: USDC_ADDRESS,
			abi: ERC20_ABI,
			functionName: "transfer",
			args: [HL_BRIDGE2, depositAmount],
		});

		console.log(`[Deposit] 트랜잭션 전송됨: ${txHash}`);
		console.log(`[Deposit] Arbiscan: https://arbiscan.io/tx/${txHash}`);

		// 트랜잭션 확인 대기
		console.log(`[Deposit] 컨펌 대기 중...`);
		const receipt = await publicClient.waitForTransactionReceipt({
			hash: txHash,
			confirmations: 1,
		});

		if (receipt.status === "success") {
			console.log(`[Deposit] ✅ 전송 성공! 블록 #${receipt.blockNumber}`);
			console.log(`[Deposit] HyperLiquid 입금은 약 1분 내 처리됩니다.`);

			// 잔여 USDC 잔고 확인
			const remaining = await publicClient.readContract({
				address: USDC_ADDRESS,
				abi: ERC20_ABI,
				functionName: "balanceOf",
				args: [account.address],
			});

			console.log(JSON.stringify({
				status: "success",
				txHash,
				amount: depositFormatted,
				blockNumber: Number(receipt.blockNumber),
				gasUsed: receipt.gasUsed.toString(),
				remainingUsdc: formatUnits(remaining, USDC_DECIMALS),
				arbiscan: `https://arbiscan.io/tx/${txHash}`,
				note: "HyperLiquid 입금은 약 1분 내 처리됩니다",
			}, null, 2));
		} else {
			console.error(JSON.stringify({
				status: "error",
				error: "트랜잭션 실패 (reverted)",
				txHash,
			}));
			process.exit(1);
		}
	} catch (err) {
		console.error(JSON.stringify({
			status: "error",
			error: err instanceof Error ? err.message : String(err),
		}));
		process.exit(1);
	}
}

main();
