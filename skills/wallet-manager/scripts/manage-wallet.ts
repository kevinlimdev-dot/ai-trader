/**
 * wallet-manager 스킬 스크립트
 * 코인베이스 Agentic Wallet과 하이퍼리퀴드 잔고를 관리하고 자금 이동을 처리한다.
 *
 * 사용법:
 *   bun run skills/wallet-manager/scripts/manage-wallet.ts --action balance
 *   bun run skills/wallet-manager/scripts/manage-wallet.ts --action fund --amount 500
 *   bun run skills/wallet-manager/scripts/manage-wallet.ts --action withdraw --amount 500
 *   bun run skills/wallet-manager/scripts/manage-wallet.ts --action process-requests
 *   bun run skills/wallet-manager/scripts/manage-wallet.ts --action daily-report
 */

import { HyperliquidService } from "../../../src/services/hyperliquid.service";
import { CoinbaseService } from "../../../src/services/coinbase.service";
import { loadConfig, isPaperMode } from "../../../src/utils/config";
import { createLogger } from "../../../src/utils/logger";
import {
  insertWalletTransfer,
  insertBalanceSnapshot,
  getTodayTransferTotal,
  getLatestBalance,
} from "../../../src/db/repository";
import type { WalletTransfer, BalanceSnapshot } from "../../../src/models/order";

const logger = createLogger("WalletManager");

// CLI 인자 파싱
function parseArgs(): { action: string; amount?: number } {
  const args = process.argv.slice(2);
  const actionIdx = args.indexOf("--action");
  const amountIdx = args.indexOf("--amount");
  return {
    action: actionIdx >= 0 ? args[actionIdx + 1] : "balance",
    amount: amountIdx >= 0 ? parseFloat(args[amountIdx + 1]) : undefined,
  };
}

// ─── 보안 검증 ───

function validateTransfer(amount: number, direction: string): { ok: boolean; reason?: string } {
  const config = loadConfig();
  const limits = config.wallet_agent.transfers;
  const security = config.wallet_agent.security;

  if (amount <= 0) return { ok: false, reason: "금액은 0보다 커야 합니다" };
  if (amount > limits.max_single_transfer) {
    return { ok: false, reason: `단일 전송 한도 초과: ${amount} > ${limits.max_single_transfer} USDC` };
  }

  const todayTotal = getTodayTransferTotal();
  if (todayTotal + amount > limits.max_daily_transfer) {
    return { ok: false, reason: `일일 전송 한도 초과: ${todayTotal + amount} > ${limits.max_daily_transfer} USDC` };
  }

  return { ok: true };
}

// ─── Actions ───

async function checkBalance(hl: HyperliquidService, cb: CoinbaseService): Promise<void> {
  if (isPaperMode()) {
    const latest = getLatestBalance();
    console.log(JSON.stringify({
      status: "success",
      mode: "paper",
      balances: latest || {
        coinbase_balance: 5000,
        hyperliquid_balance: 5000,
        total_balance: 10000,
      },
    }, null, 2));
    return;
  }

  const [hlBalance, cbBalance] = await Promise.all([
    hl.getBalance(),
    cb.getUsdcBalance(),
  ]);

  const snapshot: BalanceSnapshot = {
    timestamp: new Date().toISOString(),
    coinbase_balance: cbBalance,
    hyperliquid_balance: hlBalance,
    total_balance: cbBalance + hlBalance,
  };

  insertBalanceSnapshot(snapshot);

  const config = loadConfig();
  const alerts: string[] = [];

  if (hlBalance < config.wallet_agent.security.min_reserve_hyperliquid) {
    alerts.push(`하이퍼리퀴드 잔고 부족: ${hlBalance} < ${config.wallet_agent.security.min_reserve_hyperliquid} USDC`);
  }
  if (cbBalance < config.wallet_agent.security.min_reserve_coinbase) {
    alerts.push(`코인베이스 잔고 부족: ${cbBalance} < ${config.wallet_agent.security.min_reserve_coinbase} USDC`);
  }
  if (hlBalance < config.wallet_agent.monitoring.low_balance_alert_usdc) {
    alerts.push(`하이퍼리퀴드 잔고 경고: ${hlBalance} < ${config.wallet_agent.monitoring.low_balance_alert_usdc} USDC`);
  }

  console.log(JSON.stringify({
    status: "success",
    mode: "live",
    balances: {
      coinbase: cbBalance,
      hyperliquid: hlBalance,
      total: cbBalance + hlBalance,
    },
    alerts: alerts.length > 0 ? alerts : undefined,
  }, null, 2));
}

async function fundHyperliquid(cb: CoinbaseService, amount: number): Promise<void> {
  const validation = validateTransfer(amount, "coinbase_to_hl");
  if (!validation.ok) {
    console.log(JSON.stringify({ status: "rejected", reason: validation.reason }));
    return;
  }

  if (isPaperMode()) {
    const transfer: WalletTransfer = {
      transfer_id: `paper_fund_${Date.now()}`,
      timestamp: new Date().toISOString(),
      direction: "coinbase_to_hl",
      amount,
      currency: "USDC",
      status: "completed",
    };
    insertWalletTransfer(transfer);

    console.log(JSON.stringify({
      status: "success",
      mode: "paper",
      transfer: { direction: "coinbase → hyperliquid", amount, currency: "USDC" },
    }, null, 2));
    return;
  }

  try {
    const result = await cb.fundHyperliquid(amount);

    const transfer: WalletTransfer = {
      transfer_id: result.id,
      timestamp: new Date().toISOString(),
      direction: "coinbase_to_hl",
      amount,
      currency: "USDC",
      status: result.status === "completed" ? "completed" : "pending",
      tx_hash: result.tx_hash,
    };
    insertWalletTransfer(transfer);

    console.log(JSON.stringify({
      status: "success",
      mode: "live",
      transfer: {
        id: result.id,
        direction: "coinbase → hyperliquid",
        amount,
        currency: "USDC",
        tx_status: result.status,
        tx_hash: result.tx_hash,
      },
    }, null, 2));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ status: "error", error: msg }));
    process.exit(1);
  }
}

async function withdrawToConbase(_hl: HyperliquidService, amount: number): Promise<void> {
  const validation = validateTransfer(amount, "hl_to_coinbase");
  if (!validation.ok) {
    console.log(JSON.stringify({ status: "rejected", reason: validation.reason }));
    return;
  }

  if (isPaperMode()) {
    const transfer: WalletTransfer = {
      transfer_id: `paper_withdraw_${Date.now()}`,
      timestamp: new Date().toISOString(),
      direction: "hl_to_coinbase",
      amount,
      currency: "USDC",
      status: "completed",
    };
    insertWalletTransfer(transfer);

    console.log(JSON.stringify({
      status: "success",
      mode: "paper",
      transfer: { direction: "hyperliquid → coinbase", amount, currency: "USDC" },
    }, null, 2));
    return;
  }

  // 하이퍼리퀴드 인출은 SDK의 withdraw 메서드 사용
  // 실제 구현 시 HyperliquidService에 withdraw 메서드 추가 필요
  console.log(JSON.stringify({
    status: "not_implemented",
    message: "하이퍼리퀴드 → 코인베이스 인출 기능은 추후 구현 예정",
  }, null, 2));
}

async function dailyReport(hl: HyperliquidService, cb: CoinbaseService): Promise<void> {
  const latest = getLatestBalance();
  const todayTransfers = getTodayTransferTotal();

  console.log(JSON.stringify({
    status: "success",
    report: {
      date: new Date().toISOString().split("T")[0],
      latest_balance: latest,
      today_transfers_total: todayTransfers,
    },
  }, null, 2));
}

// ─── Main ───

async function main(): Promise<void> {
  const { action, amount } = parseArgs();

  const hl = new HyperliquidService();
  const cb = new CoinbaseService();

  // 실제 모드에서 지갑 초기화
  if (!isPaperMode() && ["balance", "withdraw", "daily-report"].includes(action)) {
    const pk = process.env.HYPERLIQUID_PRIVATE_KEY;
    if (pk) await hl.initWallet(pk);
  }

  switch (action) {
    case "balance":
      await checkBalance(hl, cb);
      break;
    case "fund":
      if (amount === undefined) {
        console.error(JSON.stringify({ status: "error", error: "--amount 파라미터가 필요합니다" }));
        process.exit(1);
      }
      await fundHyperliquid(cb, amount as number);
      break;
    case "withdraw":
      if (amount === undefined) {
        console.error(JSON.stringify({ status: "error", error: "--amount 파라미터가 필요합니다" }));
        process.exit(1);
      }
      await withdrawToConbase(hl, amount as number);
      break;
    case "daily-report":
      await dailyReport(hl, cb);
      break;
    default:
      console.error(JSON.stringify({ status: "error", error: `알 수 없는 액션: ${action}` }));
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(JSON.stringify({
    status: "error",
    error: err instanceof Error ? err.message : String(err),
    retryable: true,
  }));
  process.exit(1);
});
