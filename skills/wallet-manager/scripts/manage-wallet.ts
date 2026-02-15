/**
 * wallet-manager 스킬 스크립트
 * 코인베이스 Agentic Wallet(awal CLI)과 하이퍼리퀴드 잔고를 관리하고 자금 이동을 처리한다.
 *
 * 사용법:
 *   bun run skills/wallet-manager/scripts/manage-wallet.ts --action balance
 *   bun run skills/wallet-manager/scripts/manage-wallet.ts --action fund --amount 500
 *   bun run skills/wallet-manager/scripts/manage-wallet.ts --action withdraw --amount 500
 *   bun run skills/wallet-manager/scripts/manage-wallet.ts --action process-requests
 *   bun run skills/wallet-manager/scripts/manage-wallet.ts --action auto-fund
 *   bun run skills/wallet-manager/scripts/manage-wallet.ts --action daily-report
 */

import { resolve } from "path";
import { HyperliquidService } from "../../../src/services/hyperliquid.service";
import { CoinbaseService } from "../../../src/services/coinbase.service";
import { loadConfig, isPaperMode, getProjectRoot } from "../../../src/utils/config";
import { createLogger } from "../../../src/utils/logger";
import { readJsonFile, atomicWrite } from "../../../src/utils/file";
import {
  insertWalletTransfer,
  insertBalanceSnapshot,
  getTodayTransferTotal,
  getLatestBalance,
  closeDb,
} from "../../../src/db/repository";
import type { WalletTransfer, BalanceSnapshot, FundRequest } from "../../../src/models/order";

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

function validateWhitelist(toAddress: string): { ok: boolean; reason?: string } {
  const config = loadConfig();
  const whitelist = config.wallet_agent.security.whitelist;

  // 화이트리스트가 비어있으면 제한 없음 (개발 모드)
  if (!whitelist || whitelist.length === 0) {
    logger.warn("화이트리스트가 비어있습니다. 모든 주소로 전송 가능합니다.");
    return { ok: true };
  }

  const normalized = toAddress.toLowerCase();
  const isWhitelisted = whitelist.some((addr: string) => addr.toLowerCase() === normalized);

  if (!isWhitelisted) {
    return { ok: false, reason: `주소가 화이트리스트에 없습니다: ${toAddress}` };
  }

  return { ok: true };
}

function validateMinReserve(
  direction: string,
  amount: number,
  coinbaseBalance: number,
  hlBalance: number,
): { ok: boolean; reason?: string } {
  const config = loadConfig();
  const minCoinbase = config.wallet_agent.security.min_reserve_coinbase;
  const minHl = config.wallet_agent.security.min_reserve_hyperliquid;

  if (direction === "coinbase_to_hl") {
    const remaining = coinbaseBalance - amount;
    if (remaining < minCoinbase) {
      return {
        ok: false,
        reason: `코인베이스 최소 보유 잔고 위반: 전송 후 잔고 ${remaining.toFixed(2)} < 최소 ${minCoinbase} USDC`,
      };
    }
  } else if (direction === "hl_to_coinbase") {
    const remaining = hlBalance - amount;
    if (remaining < minHl) {
      return {
        ok: false,
        reason: `하이퍼리퀴드 최소 보유 잔고 위반: 전송 후 잔고 ${remaining.toFixed(2)} < 최소 ${minHl} USDC`,
      };
    }
  }

  return { ok: true };
}

function validateTransfer(
  amount: number,
  direction: string,
  coinbaseBalance: number = Infinity,
  hlBalance: number = Infinity,
): { ok: boolean; reason?: string } {
  const config = loadConfig();
  const limits = config.wallet_agent.transfers;

  if (amount <= 0) return { ok: false, reason: "금액은 0보다 커야 합니다" };
  if (amount > limits.max_single_transfer) {
    return { ok: false, reason: `단일 전송 한도 초과: ${amount} > ${limits.max_single_transfer} USDC` };
  }

  const todayTotal = getTodayTransferTotal();
  if (todayTotal + amount > limits.max_daily_transfer) {
    return { ok: false, reason: `일일 전송 한도 초과: ${todayTotal + amount} > ${limits.max_daily_transfer} USDC` };
  }

  const reserveCheck = validateMinReserve(direction, amount, coinbaseBalance, hlBalance);
  if (!reserveCheck.ok) return reserveCheck;

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

  // awal 인증 상태 확인
  const authStatus = await cb.checkStatus();
  if (!authStatus.authenticated) {
    console.log(JSON.stringify({
      status: "error",
      error: "Agentic Wallet이 인증되지 않았습니다. `bunx awal auth login <email>` 로 인증해주세요.",
    }));
    return;
  }

  const [hlBalance, cbBalance, walletAddress] = await Promise.all([
    hl.getBalance(),
    cb.getUsdcBalance(),
    cb.getAddress(),
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
    wallet_email: authStatus.email,
    wallet_address: walletAddress,
    network: "base",
    balances: {
      coinbase: cbBalance,
      hyperliquid: hlBalance,
      total: cbBalance + hlBalance,
    },
    alerts: alerts.length > 0 ? alerts : undefined,
  }, null, 2));
}

async function fundHyperliquid(
  cb: CoinbaseService,
  hl: HyperliquidService,
  amount: number,
): Promise<void> {
  let cbBalance = Infinity;
  let hlBalance = 0;
  if (!isPaperMode()) {
    [cbBalance, hlBalance] = await Promise.all([
      cb.getUsdcBalance(),
      hl.getBalance(),
    ]);
  }

  const validation = validateTransfer(amount, "coinbase_to_hl", cbBalance, hlBalance);
  if (!validation.ok) {
    console.log(JSON.stringify({ status: "rejected", reason: validation.reason }));
    return;
  }

  // 화이트리스트 검증 (입금 주소)
  const depositAddress = process.env.HYPERLIQUID_DEPOSIT_ADDRESS || "";
  if (depositAddress) {
    const wlCheck = validateWhitelist(depositAddress);
    if (!wlCheck.ok) {
      console.log(JSON.stringify({ status: "rejected", reason: wlCheck.reason }));
      return;
    }
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
      transfer: { direction: "coinbase(base) → hyperliquid", amount, currency: "USDC" },
    }, null, 2));
    return;
  }

  try {
    const result = await cb.fundHyperliquid(amount);

    const transfer: WalletTransfer = {
      transfer_id: `awal_fund_${Date.now()}`,
      timestamp: new Date().toISOString(),
      direction: "coinbase_to_hl",
      amount,
      currency: "USDC",
      status: result.status === "completed" ? "completed" : "pending",
      tx_hash: result.txHash,
    };
    insertWalletTransfer(transfer);

    console.log(JSON.stringify({
      status: "success",
      mode: "live",
      transfer: {
        direction: "coinbase(base) → hyperliquid",
        amount,
        currency: "USDC",
        tx_status: result.status,
        tx_hash: result.txHash,
      },
    }, null, 2));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ status: "error", error: msg }));
    process.exit(1);
  }
}

async function withdrawToCoinbase(
  hl: HyperliquidService,
  cb: CoinbaseService,
  amount: number,
): Promise<void> {
  let cbBalance = 0;
  let hlBalance = Infinity;
  if (!isPaperMode()) {
    [cbBalance, hlBalance] = await Promise.all([
      cb.getUsdcBalance(),
      hl.getBalance(),
    ]);
  }

  const validation = validateTransfer(amount, "hl_to_coinbase", cbBalance, hlBalance);
  if (!validation.ok) {
    console.log(JSON.stringify({ status: "rejected", reason: validation.reason }));
    return;
  }

  // Agentic Wallet 주소 조회 (출금 대상)
  let coinbaseAddress: string;
  if (isPaperMode()) {
    coinbaseAddress = "0xPAPER_MODE_ADDRESS";
  } else {
    try {
      coinbaseAddress = await cb.getAddress();
    } catch {
      console.log(JSON.stringify({
        status: "error",
        error: "Agentic Wallet 주소 조회 실패. `bunx awal auth login`으로 인증해주세요.",
      }));
      return;
    }
  }

  if (!coinbaseAddress) {
    console.log(JSON.stringify({
      status: "error",
      error: "Agentic Wallet 주소를 가져올 수 없습니다.",
    }));
    return;
  }

  // 화이트리스트 검증
  const wlCheck = validateWhitelist(coinbaseAddress);
  if (!wlCheck.ok) {
    console.log(JSON.stringify({ status: "rejected", reason: wlCheck.reason }));
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
      transfer: { direction: "hyperliquid → coinbase(base)", amount, currency: "USDC" },
    }, null, 2));
    return;
  }

  // 실제 출금 (HyperLiquid → Agentic Wallet 주소)
  // 참고: HyperLiquid withdraw는 Arbitrum 네트워크로 전송됨
  // Agentic Wallet 주소가 동일한 EVM 주소이므로 수신 가능하지만,
  // awal balance에는 Base 잔고만 표시됨 (Arbitrum 수신분은 별도 브릿지 필요)
  try {
    const result = await hl.withdraw({
      amount: amount.toString(),
      destination: coinbaseAddress,
    });

    const transfer: WalletTransfer = {
      transfer_id: `hl_withdraw_${Date.now()}`,
      timestamp: new Date().toISOString(),
      direction: "hl_to_coinbase",
      amount,
      currency: "USDC",
      status: "completed",
      tx_hash: (result?.response as Record<string, unknown>)?.hash as string | undefined,
    };
    insertWalletTransfer(transfer);

    console.log(JSON.stringify({
      status: "success",
      mode: "live",
      transfer: {
        direction: "hyperliquid(arbitrum) → coinbase wallet",
        destination: coinbaseAddress,
        amount,
        currency: "USDC",
        note: "HyperLiquid은 Arbitrum으로 출금. Agentic Wallet에서 Base 잔고로 보려면 브릿지 필요.",
        result,
      },
    }, null, 2));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ status: "error", error: msg }));
    process.exit(1);
  }
}

// ─── 대기 중인 자금 요청 처리 ───

async function processRequests(
  hl: HyperliquidService,
  cb: CoinbaseService,
): Promise<void> {
  const root = getProjectRoot();
  const requestPath = resolve(root, "data/fund-requests/latest.json");

  const request = readJsonFile<FundRequest>(requestPath);

  if (!request) {
    console.log(JSON.stringify({ status: "no_requests", message: "대기 중인 자금 요청이 없습니다." }));
    return;
  }

  if (request.status !== "pending") {
    console.log(JSON.stringify({
      status: "already_processed",
      request_id: request.request_id,
      request_status: request.status,
    }));
    return;
  }

  logger.info("자금 요청 처리 시작", {
    request_id: request.request_id,
    type: request.type,
    amount: request.amount,
    reason: request.reason,
    priority: request.priority,
  });

  // 요청 상태를 processing으로 업데이트
  request.status = "processing";
  await atomicWrite(requestPath, request);

  try {
    if (request.type === "fund") {
      await fundHyperliquid(cb, hl, request.amount);
    } else if (request.type === "withdraw") {
      await withdrawToCoinbase(hl, cb, request.amount);
    }

    request.status = "completed";
    await atomicWrite(requestPath, request);

    logger.info("자금 요청 처리 완료", { request_id: request.request_id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    request.status = "rejected";
    await atomicWrite(requestPath, request);

    logger.error("자금 요청 처리 실패", { request_id: request.request_id, error: msg });
    console.error(JSON.stringify({ status: "error", error: msg }));
  }
}

// ─── 자동 충전 로직 ───

async function autoFund(
  hl: HyperliquidService,
  cb: CoinbaseService,
): Promise<void> {
  const config = loadConfig();

  if (!config.wallet_agent.transfers.auto_fund_enabled) {
    console.log(JSON.stringify({ status: "disabled", message: "자동 충전이 비활성화되어 있습니다." }));
    return;
  }

  const minHl = config.wallet_agent.security.min_reserve_hyperliquid;
  const bufferPct = config.wallet_agent.transfers.auto_fund_buffer_pct;

  let hlBalance: number;
  let cbBalance: number;

  if (isPaperMode()) {
    const latest = getLatestBalance();
    hlBalance = latest?.hyperliquid_balance ?? 5000;
    cbBalance = latest?.coinbase_balance ?? 5000;
  } else {
    [hlBalance, cbBalance] = await Promise.all([
      hl.getBalance(),
      cb.getUsdcBalance(),
    ]);
  }

  if (hlBalance >= minHl) {
    console.log(JSON.stringify({
      status: "sufficient",
      message: `하이퍼리퀴드 잔고 충분 (${hlBalance.toFixed(2)} >= ${minHl} USDC)`,
      hl_balance: hlBalance,
    }));
    return;
  }

  const target = minHl * (1 + bufferPct);
  const needed = target - hlBalance;

  if (needed <= 0) {
    console.log(JSON.stringify({ status: "sufficient", message: "추가 충전 불필요" }));
    return;
  }

  const minCb = config.wallet_agent.security.min_reserve_coinbase;
  const available = cbBalance - minCb;

  if (available <= 0) {
    console.log(JSON.stringify({
      status: "insufficient_source",
      message: `코인베이스 잔고 부족 (사용 가능: ${available.toFixed(2)} USDC)`,
    }));
    return;
  }

  const fundAmount = Math.min(needed, available, config.wallet_agent.transfers.max_single_transfer);

  if (fundAmount <= 10) {
    console.log(JSON.stringify({ status: "too_small", message: `충전 금액이 너무 적음: ${fundAmount.toFixed(2)} USDC` }));
    return;
  }

  logger.info("자동 충전 실행", {
    hl_balance: hlBalance,
    target,
    fund_amount: fundAmount,
  });

  await fundHyperliquid(cb, hl, fundAmount);
}

// ─── 자동 리밸런싱 (단일 입금 포인트 → 자동 배분) ───

async function autoRebalance(
  hl: HyperliquidService,
  cb: CoinbaseService,
): Promise<void> {
  const config = loadConfig();
  const walletConfig = config.wallet_agent;

  if (!walletConfig.transfers.auto_fund_enabled) {
    console.log(JSON.stringify({ status: "disabled", message: "자동 자금 배분이 비활성화되어 있습니다." }));
    return;
  }

  const minHl = walletConfig.security.min_reserve_hyperliquid;
  const minCb = walletConfig.security.min_reserve_coinbase;
  const bufferPct = walletConfig.transfers.auto_fund_buffer_pct;
  const maxExcessPct = walletConfig.transfers.auto_withdraw_excess_pct ?? 0.5; // HL에 과도 보유 시 회수 비율

  let hlBalance: number;
  let cbBalance: number;

  if (isPaperMode()) {
    const latest = getLatestBalance();
    hlBalance = latest?.hyperliquid_balance ?? 5000;
    cbBalance = latest?.coinbase_balance ?? 5000;
  } else {
    [hlBalance, cbBalance] = await Promise.all([
      hl.getBalance(),
      cb.getUsdcBalance(),
    ]);
  }

  const totalBalance = hlBalance + cbBalance;
  const actions: { direction: string; amount: number; reason: string }[] = [];

  // Case 1: HL 잔고 부족 → Coinbase에서 HL로 보내기
  if (hlBalance < minHl) {
    const target = minHl * (1 + bufferPct);
    const needed = target - hlBalance;
    const available = cbBalance - minCb;

    if (available > 10 && needed > 10) {
      const fundAmount = Math.min(
        needed,
        available,
        walletConfig.transfers.max_single_transfer,
      );
      actions.push({
        direction: "coinbase_to_hl",
        amount: fundAmount,
        reason: `HL 잔고 부족 (${hlBalance.toFixed(2)} < ${minHl} USDC)`,
      });
    }
  }

  // Case 2: HL 잔고 과다 → HL에서 Coinbase로 회수
  // (거래에 필요한 것 이상으로 많이 있으면 안전을 위해 Coinbase로 회수)
  const maxHl = walletConfig.security.max_reserve_hyperliquid ?? (totalBalance * 0.6);
  if (hlBalance > maxHl && hlBalance > minHl * 2) {
    const excess = hlBalance - maxHl;
    const withdrawAmount = Math.min(
      excess * maxExcessPct,
      walletConfig.transfers.max_single_transfer,
    );
    if (withdrawAmount > 10) {
      // HL→CB 회수는 HL 충전이 필요없을 때만
      if (actions.length === 0) {
        actions.push({
          direction: "hl_to_coinbase",
          amount: withdrawAmount,
          reason: `HL 잔고 과다 (${hlBalance.toFixed(2)} > ${maxHl.toFixed(2)} USDC), 안전을 위해 Coinbase로 회수`,
        });
      }
    }
  }

  if (actions.length === 0) {
    console.log(JSON.stringify({
      status: "balanced",
      message: "자금 배분이 적절합니다.",
      balances: {
        coinbase: cbBalance,
        hyperliquid: hlBalance,
        total: totalBalance,
      },
      thresholds: { min_hl: minHl, min_cb: minCb, max_hl: maxHl },
    }, null, 2));
    return;
  }

  // 액션 실행
  const results: { action: string; result: string }[] = [];

  for (const action of actions) {
    logger.info("자동 리밸런싱 실행", action);

    try {
      if (action.direction === "coinbase_to_hl") {
        await fundHyperliquid(cb, hl, action.amount);
        results.push({ action: `CB→HL ${action.amount.toFixed(2)} USDC`, result: "success" });
      } else if (action.direction === "hl_to_coinbase") {
        await withdrawToCoinbase(hl, cb, action.amount);
        results.push({ action: `HL→CB ${action.amount.toFixed(2)} USDC`, result: "success" });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ action: `${action.direction} ${action.amount.toFixed(2)}`, result: `failed: ${msg}` });
      logger.error("리밸런싱 실패", { action, error: msg });
    }
  }

  console.log(JSON.stringify({
    status: "rebalanced",
    balances_before: { coinbase: cbBalance, hyperliquid: hlBalance },
    actions: results,
  }, null, 2));
}

async function dailyReport(hl: HyperliquidService, cb: CoinbaseService): Promise<void> {
  let balances: { coinbase: number; hyperliquid: number; total: number };

  if (isPaperMode()) {
    const latest = getLatestBalance();
    balances = {
      coinbase: latest?.coinbase_balance ?? 5000,
      hyperliquid: latest?.hyperliquid_balance ?? 5000,
      total: latest?.total_balance ?? 10000,
    };
  } else {
    const [hlBalance, cbBalance] = await Promise.all([
      hl.getBalance(),
      cb.getUsdcBalance(),
    ]);
    balances = { coinbase: cbBalance, hyperliquid: hlBalance, total: cbBalance + hlBalance };
  }

  const todayTransfers = getTodayTransferTotal();
  const config = loadConfig();

  const alerts: string[] = [];
  if (balances.hyperliquid < config.wallet_agent.security.min_reserve_hyperliquid) {
    alerts.push("하이퍼리퀴드 최소 보유 잔고 미달");
  }
  if (balances.coinbase < config.wallet_agent.security.min_reserve_coinbase) {
    alerts.push("코인베이스 최소 보유 잔고 미달");
  }

  console.log(JSON.stringify({
    status: "success",
    report: {
      date: new Date().toISOString().split("T")[0],
      network: "base (agentic wallet) + arbitrum (hyperliquid)",
      balances,
      today_transfers_total: todayTransfers,
      daily_limit_remaining: config.wallet_agent.transfers.max_daily_transfer - todayTransfers,
      alerts: alerts.length > 0 ? alerts : undefined,
    },
  }, null, 2));
}

// ─── Graceful Shutdown ───

function setupGracefulShutdown(): void {
  const cleanup = () => {
    closeDb();
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

// ─── Main ───

async function main(): Promise<void> {
  setupGracefulShutdown();

  const { action, amount } = parseArgs();

  const hl = new HyperliquidService();
  const cb = new CoinbaseService();

  // 실제 모드에서 하이퍼리퀴드 지갑 초기화
  if (!isPaperMode() && ["balance", "withdraw", "process-requests", "auto-fund", "auto-rebalance", "daily-report"].includes(action)) {
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
      await fundHyperliquid(cb, hl, amount as number);
      break;
    case "withdraw":
      if (amount === undefined) {
        console.error(JSON.stringify({ status: "error", error: "--amount 파라미터가 필요합니다" }));
        process.exit(1);
      }
      await withdrawToCoinbase(hl, cb, amount as number);
      break;
    case "process-requests":
      await processRequests(hl, cb);
      break;
    case "auto-fund":
      await autoFund(hl, cb);
      break;
    case "auto-rebalance":
      await autoRebalance(hl, cb);
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
