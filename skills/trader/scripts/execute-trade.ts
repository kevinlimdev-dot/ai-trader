/**
 * trader 스킬 스크립트
 * 매매 시그널을 검증하고 하이퍼리퀴드에서 주문을 실행한다.
 *
 * 사용법:
 *   bun run skills/trader/scripts/execute-trade.ts                     # 시그널 기반 주문
 *   bun run skills/trader/scripts/execute-trade.ts --action positions  # 포지션 조회
 *   bun run skills/trader/scripts/execute-trade.ts --action monitor    # 포지션 모니터링 (SL/TP/트레일링)
 *   bun run skills/trader/scripts/execute-trade.ts --action close-all  # 전체 청산
 *   bun run skills/trader/scripts/execute-trade.ts --action emergency  # 긴급 청산
 *   bun run skills/trader/scripts/execute-trade.ts --action daily-summary  # 일일 요약
 */

import { resolve } from "path";
import { existsSync, readFileSync } from "fs";
import { HyperliquidService } from "../../../src/services/hyperliquid.service";
import { RiskManager } from "../../../src/utils/risk-manager";
import { loadConfig, isPaperMode, getProjectRoot } from "../../../src/utils/config";
import { createLogger } from "../../../src/utils/logger";
import { atomicWrite } from "../../../src/utils/file";
import {
  insertTrade,
  updateTrade,
  getOpenTrades,
  getDailySummary,
  getLatestBalance,
  incrementApiErrorCount,
  resetApiErrorCount,
  closeDb,
} from "../../../src/db/repository";
import type { SignalCollection, TradeSignal } from "../../../src/models/trade-signal";
import type { TradeRecord, FundRequest, ExitReason } from "../../../src/models/order";

const logger = createLogger("Trader");

// ─── Graceful Shutdown ───

function setupGracefulShutdown(): void {
  const cleanup = () => {
    closeDb();
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

// ─── CLI 인자 파싱 ───

function parseArgs(): { action: string; reason?: string } {
  const args = process.argv.slice(2);
  const actionIdx = args.indexOf("--action");
  const reasonIdx = args.indexOf("--reason");
  return {
    action: actionIdx >= 0 ? args[actionIdx + 1] : "execute",
    reason: reasonIdx >= 0 ? args[reasonIdx + 1] : undefined,
  };
}

// ─── 자금 요청 파일 생성 (trader → wallet-manager) ───

async function createFundRequest(needed: number, reason: string): Promise<void> {
  const root = getProjectRoot();
  const request: FundRequest = {
    request_id: `fund_req_${Date.now()}`,
    timestamp: new Date().toISOString(),
    type: "fund",
    amount: needed,
    reason,
    priority: needed > 500 ? "high" : "normal",
    status: "pending",
  };

  const requestPath = resolve(root, "data/fund-requests/latest.json");
  await atomicWrite(requestPath, request);
  logger.info("자금 요청 생성", { amount: needed, reason });
}

// ─── API 호출 래퍼 (연속 에러 추적) ───

async function safeApiCall<T>(fn: () => Promise<T>, risk: RiskManager): Promise<T> {
  const config = loadConfig();
  try {
    const result = await fn();
    resetApiErrorCount();
    return result;
  } catch (err) {
    const errorCount = incrementApiErrorCount();
    const maxErrors = config.trade_agent.safety.max_consecutive_api_errors;

    if (errorCount >= maxErrors) {
      logger.error(`연속 API 에러 ${errorCount}회 - 비상 중지 활성화`);
      risk.createKillSwitch(`consecutive_api_errors_${errorCount}`);
    }

    throw err;
  }
}

// ─── 현재 가격 가져오기 (live/paper 공통) ───

async function getCurrentPrice(hl: HyperliquidService, symbol: string): Promise<number> {
  // 페이퍼 모드에서도 실제 가격 API를 호출하여 정확한 시뮬레이션
  try {
    const price = await hl.getMidPrice(symbol);
    if (price > 0) return price;
  } catch {
    // API 실패 시 스냅샷에서 가격 가져오기
  }

  // 폴백: 최신 스냅샷에서 가격 읽기
  const root = getProjectRoot();
  const snapshotPath = resolve(root, "data/snapshots/latest.json");
  if (existsSync(snapshotPath)) {
    try {
      const raw = readFileSync(snapshotPath, "utf-8");
      const collection = JSON.parse(raw);
      const snap = collection.snapshots?.find((s: any) => s.symbol === symbol);
      if (snap?.hyperliquid?.mid_price) return snap.hyperliquid.mid_price;
      if (snap?.binance?.mark_price) return snap.binance.mark_price;
    } catch {
      // ignore
    }
  }

  return 0;
}

// ─── Actions ───

async function executeSignals(hl: HyperliquidService, risk: RiskManager): Promise<void> {
  const root = getProjectRoot();
  const config = loadConfig();
  const signalPath = resolve(root, "data/signals/latest.json");

  if (!existsSync(signalPath)) {
    console.log(JSON.stringify({ status: "no_signals", message: "시그널 파일이 없습니다." }));
    return;
  }

  const raw = readFileSync(signalPath, "utf-8");
  const collection: SignalCollection = JSON.parse(raw);

  // 신선도 체크
  const maxAgeMs = (config.trade_agent.signal_max_age_seconds || 60) * 1000;
  const age = Date.now() - new Date(collection.generated_at).getTime();
  if (age > maxAgeMs) {
    console.log(JSON.stringify({
      status: "stale_signal",
      message: `시그널이 ${Math.floor(age / 1000)}초 이상 오래되었습니다.`,
      age_seconds: Math.floor(age / 1000),
    }));
    return;
  }

  const balance = isPaperMode() ? 10000 : await safeApiCall(() => hl.getBalance(), risk);
  const latestBal = getLatestBalance();
  const startBalance = latestBal?.total_balance || balance;

  // 가격 이상 감지
  for (const signal of collection.signals) {
    if (signal.action === "HOLD") continue;
    const snapshotPath = resolve(root, "data/snapshots/latest.json");
    if (existsSync(snapshotPath)) {
      try {
        const snapRaw = readFileSync(snapshotPath, "utf-8");
        const snapCollection = JSON.parse(snapRaw);
        const snap = snapCollection.snapshots?.find((s: any) => s.symbol === signal.symbol);
        if (snap) {
          const prevPrice = snap.binance?.mark_price || 0;
          if (prevPrice > 0 && risk.isPriceAnomaly(prevPrice, signal.entry_price)) {
            logger.error(`${signal.symbol} 가격 이상 감지 - 비상 모드 전환`, {
              prev: prevPrice,
              current: signal.entry_price,
              threshold: config.trade_agent.safety.price_anomaly_threshold,
            });
            risk.createKillSwitch(`price_anomaly_${signal.symbol}`);
            console.log(JSON.stringify({
              status: "emergency",
              reason: `${signal.symbol} 가격 이상 감지 (${config.trade_agent.safety.price_anomaly_threshold}% 초과)`,
              kill_switch: true,
            }));
            return;
          }
        }
      } catch {
        // 스냅샷 읽기 실패 시 무시
      }
    }
  }

  const results: any[] = [];

  for (const signal of collection.signals) {
    if (signal.action === "HOLD") {
      results.push({ symbol: signal.symbol, action: "HOLD", reason: "진입 조건 미충족" });
      continue;
    }

    // 리스크 검증
    const validation = risk.validateTrade({
      balance,
      startBalance,
      confidence: signal.confidence,
    });

    if (!validation.allowed) {
      results.push({ symbol: signal.symbol, action: signal.action, skipped: true, reason: validation.reason });
      logger.warn(`${signal.symbol} 거래 스킵`, { reason: validation.reason });
      continue;
    }

    // 포지션 크기 계산
    const leverage = risk.getLeverage();
    const size = risk.calculatePositionSize({
      balance,
      entryPrice: signal.entry_price,
      stopLoss: signal.stop_loss,
      leverage,
    });

    if (size <= 0) {
      // insufficient_balance 응답 및 자금 요청
      if (balance < config.trade_agent.risk.min_balance_usdc) {
        await createFundRequest(
          Math.max(config.trade_agent.risk.min_balance_usdc - balance, 500),
          `${signal.symbol} 진입을 위한 잔고 부족`,
        );
        results.push({
          symbol: signal.symbol,
          action: signal.action,
          status: "insufficient_balance",
          needed: parseFloat(Math.max(config.trade_agent.risk.min_balance_usdc - balance, 500).toFixed(2)),
          current_balance: parseFloat(balance.toFixed(2)),
        });
      } else {
        results.push({ symbol: signal.symbol, action: signal.action, skipped: true, reason: "포지션 크기 0" });
      }
      continue;
    }

    const tradeId = `${signal.symbol}_${Date.now()}`;
    const isBuy = signal.action === "LONG";

    if (isPaperMode()) {
      // 페이퍼 트레이딩 (수수료 시뮬레이션 포함)
      const feeRate = config.trade_agent.paper_fee_rate || 0.0005;
      const fees = signal.entry_price * size * feeRate;
      const trade: TradeRecord = {
        trade_id: `paper_${tradeId}`,
        timestamp_open: new Date().toISOString(),
        symbol: signal.symbol,
        side: signal.action,
        entry_price: signal.entry_price,
        size,
        leverage,
        stop_loss: signal.stop_loss,
        take_profit: signal.take_profit,
        peak_pnl_pct: 0,
        trailing_activated: 0,
        fees,
        signal_confidence: signal.confidence,
        status: "paper",
      };
      insertTrade(trade);

      results.push({
        symbol: signal.symbol,
        action: signal.action,
        mode: "paper",
        entry_price: signal.entry_price,
        size: parseFloat(size.toFixed(6)),
        leverage,
        stop_loss: parseFloat(signal.stop_loss.toFixed(2)),
        take_profit: parseFloat(signal.take_profit.toFixed(2)),
        confidence: signal.confidence,
        fees: parseFloat(fees.toFixed(4)),
      });

      logger.info(`[PAPER] ${signal.symbol} ${signal.action} 진입`, {
        size: size.toFixed(6),
        entry: signal.entry_price,
        sl: signal.stop_loss.toFixed(2),
        tp: signal.take_profit.toFixed(2),
      });
    } else {
      // 실제 주문
      try {
        await safeApiCall(() => hl.setLeverage(signal.symbol, leverage), risk);
        const orderResult = await safeApiCall(
          () => hl.placeMarketOrder({ coin: signal.symbol, isBuy, size }),
          risk,
        );

        const trade: TradeRecord = {
          trade_id: tradeId,
          timestamp_open: new Date().toISOString(),
          symbol: signal.symbol,
          side: signal.action,
          entry_price: signal.entry_price,
          size,
          leverage,
          stop_loss: signal.stop_loss,
          take_profit: signal.take_profit,
          peak_pnl_pct: 0,
          trailing_activated: 0,
          signal_confidence: signal.confidence,
          status: "open",
        };
        insertTrade(trade);

        results.push({
          symbol: signal.symbol,
          action: signal.action,
          mode: "live",
          entry_price: signal.entry_price,
          size: parseFloat(size.toFixed(6)),
          leverage,
          stop_loss: parseFloat(signal.stop_loss.toFixed(2)),
          take_profit: parseFloat(signal.take_profit.toFixed(2)),
          order_result: orderResult,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ symbol: signal.symbol, action: signal.action, error: msg });
        logger.error(`${signal.symbol} 주문 실패`, { error: msg });
      }
    }
  }

  console.log(JSON.stringify({ status: "success", trades: results }, null, 2));
}

// ─── 포지션 모니터링 (SL/TP/트레일링 스탑) ───

async function monitorPositions(hl: HyperliquidService, risk: RiskManager): Promise<void> {
  const openTrades = getOpenTrades();
  if (openTrades.length === 0) {
    console.log(JSON.stringify({ status: "no_positions", message: "열린 포지션이 없습니다." }));
    return;
  }

  const results: any[] = [];

  for (const trade of openTrades) {
    // 현재 가격 가져오기 (페이퍼/라이브 모두 실제 API 호출)
    let currentPrice: number;
    try {
      currentPrice = await getCurrentPrice(hl, trade.symbol);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ symbol: trade.symbol, error: msg });
      continue;
    }

    if (currentPrice <= 0) {
      results.push({ symbol: trade.symbol, error: "현재 가격을 가져올 수 없음" });
      continue;
    }

    // PnL 계산
    const direction = trade.side === "LONG" ? 1 : -1;
    const pnl = (currentPrice - trade.entry_price) * direction * trade.size;
    const pnlPct = ((currentPrice - trade.entry_price) / trade.entry_price) * direction * 100;

    // DB에서 SL/TP 가져오기 (trades 테이블에 저장된 값 우선)
    const stopLoss = trade.stop_loss || (trade.side === "LONG"
      ? trade.entry_price * 0.98
      : trade.entry_price * 1.02);
    const takeProfit = trade.take_profit || (trade.side === "LONG"
      ? trade.entry_price * 1.03
      : trade.entry_price * 0.97);

    // Peak PnL 업데이트 (DB에 저장)
    const prevPeak = trade.peak_pnl_pct || 0;
    const newPeak = Math.max(prevPeak, Math.abs(pnlPct));
    if (newPeak > prevPeak) {
      updateTrade(trade.trade_id, { peak_pnl_pct: newPeak });
    }

    let exitReason: string | null = null;

    // 스탑로스 체크
    if (trade.side === "LONG" && currentPrice <= stopLoss) {
      exitReason = "stop_loss";
    } else if (trade.side === "SHORT" && currentPrice >= stopLoss) {
      exitReason = "stop_loss";
    }

    // 테이크프로핏 체크
    if (!exitReason) {
      if (trade.side === "LONG" && currentPrice >= takeProfit) {
        exitReason = "take_profit";
      } else if (trade.side === "SHORT" && currentPrice <= takeProfit) {
        exitReason = "take_profit";
      }
    }

    // 트레일링 스탑 체크
    if (!exitReason) {
      const absPnlPct = Math.abs(pnlPct);
      const isActivated = trade.trailing_activated === 1 || risk.shouldActivateTrailingStop(absPnlPct);

      // 처음 활성화되면 DB에 기록
      if (isActivated && trade.trailing_activated !== 1) {
        updateTrade(trade.trade_id, { trailing_activated: 1 });
        logger.info(`${trade.symbol} 트레일링 스탑 활성화`, { pnl_pct: pnlPct.toFixed(2) });
      }

      if (isActivated && risk.shouldTriggerTrailingStop(absPnlPct, newPeak)) {
        exitReason = "trailing_stop";
        logger.info(`${trade.symbol} 트레일링 스탑 트리거`, {
          peak: newPeak.toFixed(2),
          current: absPnlPct.toFixed(2),
          drawdown: (newPeak - absPnlPct).toFixed(2),
        });
      }
    }

    if (exitReason) {
      // 포지션 청산
      if (!isPaperMode()) {
        try {
          const isBuy = trade.side === "SHORT"; // 반대 방향으로 청산
          await safeApiCall(
            () => hl.placeMarketOrder({
              coin: trade.symbol,
              isBuy,
              size: trade.size,
              reduceOnly: true,
            }),
            risk,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error(`${trade.symbol} 청산 실패`, { error: msg });
          results.push({ symbol: trade.symbol, action: "close_failed", error: msg });
          continue;
        }
      }

      // 수수료 계산
      const exitFeeRate = loadConfig().trade_agent.paper_fee_rate || 0.0005;
      const exitFees = currentPrice * trade.size * exitFeeRate;
      const totalFees = (trade.fees || 0) + exitFees;

      // DB 업데이트
      updateTrade(trade.trade_id, {
        status: "closed",
        timestamp_close: new Date().toISOString(),
        exit_price: currentPrice,
        pnl: parseFloat((pnl - totalFees).toFixed(4)),
        pnl_pct: parseFloat(pnlPct.toFixed(4)),
        fees: parseFloat(totalFees.toFixed(4)),
        exit_reason: exitReason as ExitReason,
      });

      results.push({
        symbol: trade.symbol,
        action: "closed",
        exit_reason: exitReason,
        entry_price: trade.entry_price,
        exit_price: currentPrice,
        pnl: parseFloat((pnl - totalFees).toFixed(4)),
        pnl_pct: `${pnlPct.toFixed(2)}%`,
        fees: parseFloat(totalFees.toFixed(4)),
      });

      logger.info(`${trade.symbol} 포지션 청산`, {
        reason: exitReason,
        pnl: (pnl - totalFees).toFixed(4),
        pnl_pct: `${pnlPct.toFixed(2)}%`,
      });
    } else {
      results.push({
        symbol: trade.symbol,
        action: "holding",
        entry_price: trade.entry_price,
        current_price: currentPrice,
        pnl: parseFloat(pnl.toFixed(4)),
        pnl_pct: `${pnlPct.toFixed(2)}%`,
        stop_loss: parseFloat(stopLoss.toFixed(2)),
        take_profit: parseFloat(takeProfit.toFixed(2)),
        peak_pnl_pct: `${newPeak.toFixed(2)}%`,
        trailing_active: trade.trailing_activated === 1 || risk.shouldActivateTrailingStop(Math.abs(pnlPct)),
      });
    }
  }

  console.log(JSON.stringify({ status: "success", positions: results }, null, 2));
}

async function showPositions(hl: HyperliquidService): Promise<void> {
  if (isPaperMode()) {
    const openTrades = getOpenTrades();
    console.log(JSON.stringify({
      status: "success",
      mode: "paper",
      positions: openTrades.map((t) => ({
        trade_id: t.trade_id,
        symbol: t.symbol,
        side: t.side,
        entry_price: t.entry_price,
        size: t.size,
        leverage: t.leverage,
        stop_loss: t.stop_loss,
        take_profit: t.take_profit,
        status: t.status,
      })),
    }, null, 2));
  } else {
    const positions = await hl.getOpenPositions();
    const balance = await hl.getBalance();
    console.log(JSON.stringify({
      status: "success",
      mode: "live",
      balance,
      positions: positions.map((p) => ({
        coin: p.position.coin,
        size: p.position.szi,
        entry_price: p.position.entryPx,
        unrealized_pnl: p.position.unrealizedPnl,
        leverage: p.position.leverage?.value,
      })),
    }, null, 2));
  }
}

async function closeAll(hl: HyperliquidService, reason: string = "manual"): Promise<void> {
  const openTrades = getOpenTrades();

  if (!isPaperMode()) {
    await hl.closeAllPositions();
  }

  // DB 거래도 닫기
  for (const trade of openTrades) {
    // 현재 가격으로 PnL 계산
    const currentPrice = await getCurrentPrice(hl, trade.symbol);
    const direction = trade.side === "LONG" ? 1 : -1;
    const pnl = currentPrice > 0
      ? (currentPrice - trade.entry_price) * direction * trade.size
      : 0;
    const pnlPct = currentPrice > 0
      ? ((currentPrice - trade.entry_price) / trade.entry_price) * direction * 100
      : 0;

    updateTrade(trade.trade_id, {
      status: "closed",
      timestamp_close: new Date().toISOString(),
      exit_price: currentPrice || undefined,
      pnl: pnl ? parseFloat(pnl.toFixed(4)) : undefined,
      pnl_pct: pnlPct ? parseFloat(pnlPct.toFixed(4)) : undefined,
      exit_reason: reason as ExitReason,
    });
  }

  console.log(JSON.stringify({
    status: "success",
    mode: isPaperMode() ? "paper" : "live",
    closed: openTrades.length,
    reason,
  }, null, 2));
}

async function emergency(hl: HyperliquidService, risk: RiskManager): Promise<void> {
  logger.error("비상 청산 실행");
  risk.createKillSwitch("emergency_manual");
  await closeAll(hl, "emergency");

  console.log(JSON.stringify({
    status: "emergency_executed",
    kill_switch: true,
    message: "모든 포지션이 청산되었고 KILL_SWITCH가 활성화되었습니다. 수동으로 해제하세요.",
  }, null, 2));
}

async function dailySummaryAction(): Promise<void> {
  const summary = getDailySummary();
  if (!summary) {
    console.log(JSON.stringify({ status: "no_trades", message: "오늘 거래 내역이 없습니다." }));
    return;
  }

  console.log(JSON.stringify({
    status: "success",
    summary: {
      ...summary,
      win_rate: parseFloat((summary.win_rate * 100).toFixed(1)) + "%",
      total_pnl: parseFloat(summary.total_pnl.toFixed(2)),
      total_pnl_pct: parseFloat(summary.total_pnl_pct.toFixed(2)) + "%",
      max_win: parseFloat(summary.max_win.toFixed(2)),
      max_loss: parseFloat(summary.max_loss.toFixed(2)),
      avg_pnl: parseFloat(summary.avg_pnl.toFixed(2)),
      total_fees: parseFloat(summary.total_fees.toFixed(2)),
      balance_start: parseFloat(summary.balance_start.toFixed(2)),
      balance_end: parseFloat(summary.balance_end.toFixed(2)),
    },
  }, null, 2));
}

// ─── Main ───

async function main(): Promise<void> {
  setupGracefulShutdown();

  const { action, reason } = parseArgs();
  const config = loadConfig();
  const hl = new HyperliquidService();
  const risk = new RiskManager();

  // Kill switch 확인 (emergency 제외)
  if (action !== "emergency" && action !== "positions" && action !== "daily-summary") {
    if (risk.isKillSwitchActive()) {
      console.log(JSON.stringify({
        status: "kill_switch_active",
        message: "KILL_SWITCH가 활성화되어 있습니다. 거래가 중지되었습니다.",
      }));
      return;
    }
  }

  // 실제 거래 시 지갑 초기화
  if (!isPaperMode() && action !== "daily-summary") {
    const pk = process.env.HYPERLIQUID_PRIVATE_KEY;
    if (!pk) {
      console.error(JSON.stringify({ status: "error", error: "HYPERLIQUID_PRIVATE_KEY가 설정되지 않았습니다" }));
      process.exit(1);
      return;
    }
    await hl.initWallet(pk);
  }

  switch (action) {
    case "execute":
      await executeSignals(hl, risk);
      break;
    case "monitor":
      await monitorPositions(hl, risk);
      break;
    case "positions":
      await showPositions(hl);
      break;
    case "close-all":
      await closeAll(hl, reason || "manual");
      break;
    case "emergency":
      await emergency(hl, risk);
      break;
    case "daily-summary":
      await dailySummaryAction();
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
