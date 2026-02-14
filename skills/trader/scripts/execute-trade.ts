/**
 * trader 스킬 스크립트
 * 매매 시그널을 검증하고 하이퍼리퀴드에서 주문을 실행한다.
 *
 * 사용법:
 *   bun run skills/trader/scripts/execute-trade.ts                     # 시그널 기반 주문
 *   bun run skills/trader/scripts/execute-trade.ts --action positions  # 포지션 조회
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
import {
  insertTrade,
  updateTrade,
  getOpenTrades,
  getDailySummary,
  getLatestBalance,
} from "../../../src/db/repository";
import type { SignalCollection, TradeSignal } from "../../../src/models/trade-signal";
import type { TradeRecord } from "../../../src/models/order";

const logger = createLogger("Trader");

// CLI 인자 파싱
function parseArgs(): { action: string; reason?: string } {
  const args = process.argv.slice(2);
  const actionIdx = args.indexOf("--action");
  const reasonIdx = args.indexOf("--reason");
  return {
    action: actionIdx >= 0 ? args[actionIdx + 1] : "execute",
    reason: reasonIdx >= 0 ? args[reasonIdx + 1] : undefined,
  };
}

// ─── Actions ───

async function executeSignals(hl: HyperliquidService, risk: RiskManager): Promise<void> {
  const root = getProjectRoot();
  const signalPath = resolve(root, "data/signals/latest.json");

  if (!existsSync(signalPath)) {
    console.log(JSON.stringify({ status: "no_signals", message: "시그널 파일이 없습니다." }));
    return;
  }

  const raw = readFileSync(signalPath, "utf-8");
  const collection: SignalCollection = JSON.parse(raw);

  // 신선도 체크
  const age = Date.now() - new Date(collection.generated_at).getTime();
  if (age > 60 * 1000) {
    console.log(JSON.stringify({ status: "stale_signal", message: "시그널이 1분 이상 오래되었습니다.", age_seconds: Math.floor(age / 1000) }));
    return;
  }

  const balance = isPaperMode() ? 10000 : await hl.getBalance();
  const latestBal = getLatestBalance();
  const startBalance = latestBal?.total_balance || balance;

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
    const config = loadConfig();
    const leverage = risk.getLeverage();
    const size = risk.calculatePositionSize({
      balance,
      entryPrice: signal.entry_price,
      stopLoss: signal.stop_loss,
      leverage,
    });

    if (size <= 0) {
      results.push({ symbol: signal.symbol, action: signal.action, skipped: true, reason: "포지션 크기 0" });
      continue;
    }

    const tradeId = `${signal.symbol}_${Date.now()}`;
    const isBuy = signal.action === "LONG";

    if (isPaperMode()) {
      // 페이퍼 트레이딩
      const trade: TradeRecord = {
        trade_id: `paper_${tradeId}`,
        timestamp_open: new Date().toISOString(),
        symbol: signal.symbol,
        side: signal.action,
        entry_price: signal.entry_price,
        size,
        leverage,
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
      });

      logger.info(`[PAPER] ${signal.symbol} ${signal.action} 진입`, {
        size: size.toFixed(6),
        entry: signal.entry_price,
      });
    } else {
      // 실제 주문
      try {
        await hl.setLeverage(signal.symbol, leverage);
        const orderResult = await hl.placeMarketOrder({
          coin: signal.symbol,
          isBuy,
          size,
        });

        const trade: TradeRecord = {
          trade_id: tradeId,
          timestamp_open: new Date().toISOString(),
          symbol: signal.symbol,
          side: signal.action,
          entry_price: signal.entry_price,
          size,
          leverage,
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

async function showPositions(hl: HyperliquidService): Promise<void> {
  if (isPaperMode()) {
    const openTrades = getOpenTrades();
    console.log(JSON.stringify({
      status: "success",
      mode: "paper",
      positions: openTrades,
    }, null, 2));
  } else {
    const positions = await hl.getOpenPositions();
    const balance = await hl.getBalance();
    console.log(JSON.stringify({
      status: "success",
      mode: "live",
      balance,
      positions: positions.map((p: any) => ({
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
  if (isPaperMode()) {
    const openTrades = getOpenTrades();
    for (const trade of openTrades) {
      updateTrade(trade.trade_id, {
        status: "closed",
        timestamp_close: new Date().toISOString(),
        exit_reason: reason as any,
      });
    }
    console.log(JSON.stringify({
      status: "success",
      mode: "paper",
      closed: openTrades.length,
      reason,
    }, null, 2));
  } else {
    await hl.closeAllPositions();
    // DB 거래도 닫기
    const openTrades = getOpenTrades();
    for (const trade of openTrades) {
      updateTrade(trade.trade_id, {
        status: "closed",
        timestamp_close: new Date().toISOString(),
        exit_reason: reason as any,
      });
    }
    console.log(JSON.stringify({
      status: "success",
      mode: "live",
      closed: openTrades.length,
      reason,
    }, null, 2));
  }
}

async function emergency(hl: HyperliquidService, risk: RiskManager): Promise<void> {
  logger.error("비상 청산 실행");

  // Kill switch 생성
  risk.createKillSwitch("emergency_manual");

  // 전체 청산
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
      max_win: parseFloat(summary.max_win.toFixed(2)),
      max_loss: parseFloat(summary.max_loss.toFixed(2)),
      avg_pnl: parseFloat(summary.avg_pnl.toFixed(2)),
    },
  }, null, 2));
}

// ─── Main ───

async function main(): Promise<void> {
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
      return; // unreachable but satisfies TS
    }
    await hl.initWallet(pk);
  }

  switch (action) {
    case "execute":
      await executeSignals(hl, risk);
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
