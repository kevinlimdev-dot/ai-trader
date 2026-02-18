#!/usr/bin/env bun
/**
 * AI 스마트 익절 스크립트
 *
 * 수익 중인 포지션에 대해 현재 시장 지표를 분석하고,
 * OpenClaw AI가 "지금 익절할지" 판단하여 청산합니다.
 *
 * Runner의 매 사이클 끝에서 호출됩니다.
 * 포지션 모니터의 기계적 SL/TP/트레일링과는 별개로,
 * AI가 시장 상황을 종합 판단하여 조기 익절을 결정합니다.
 *
 * Usage:
 *   bun run skills/trader/scripts/smart-tp.ts
 *
 * Output (JSON):
 *   { "checked": 2, "closed": 1, "decisions": [...] }
 */
import { resolve } from "path";
import { existsSync, readFileSync } from "fs";
import { getProjectRoot, loadConfig, isPaperMode, getStrategy } from "../../../src/utils/config";
import { getStrategyPreset } from "../../../src/strategies/presets";
import { getOpenTrades, updateTrade, closeDb } from "../../../src/db/repository";
import { HyperliquidService } from "../../../src/services/hyperliquid.service";
import { createLogger } from "../../../src/utils/logger";
import type { ExitReason } from "../../../src/models/order";

const logger = createLogger("SmartTP");
const root = getProjectRoot();

function readJson(path: string): any {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf-8")); } catch { return null; }
}

async function main() {
  const config = loadConfig();
  const strategyName = getStrategy();
  const preset = getStrategyPreset(strategyName);
  const minProfitPct = preset.trade.smart_tp?.min_profit_pct ?? 0.8;

  const openTrades = getOpenTrades();
  if (openTrades.length === 0) {
    console.log(JSON.stringify({ checked: 0, closed: 0, decisions: [], message: "열린 포지션 없음" }));
    closeDb();
    return;
  }

  const hl = new HyperliquidService();
  const privateKey = process.env.HYPERLIQUID_PRIVATE_KEY || config.trade_agent?.hyperliquid?.private_key;
  if (privateKey && privateKey.length > 10) {
    await hl.initWallet(privateKey);
  }

  const signals = readJson(resolve(root, "data/signals/latest.json"));
  const sentiment = readJson(resolve(root, "data/sentiment/latest.json"));

  const profitablePositions: any[] = [];

  for (const trade of openTrades) {
    let currentPrice: number;
    try {
      currentPrice = await hl.getMidPrice(trade.symbol);
    } catch {
      continue;
    }
    if (currentPrice <= 0) continue;

    const direction = trade.side === "LONG" ? 1 : -1;
    const pnlPct = ((currentPrice - trade.entry_price) / trade.entry_price) * direction * 100;

    if (pnlPct >= minProfitPct) {
      const peakPnlPct = trade.peak_pnl_pct || pnlPct;
      const tpDistance = trade.take_profit
        ? Math.abs(trade.take_profit - trade.entry_price) / trade.entry_price * 100
        : 0;
      const tpProgress = tpDistance > 0 ? (pnlPct / tpDistance * 100) : 0;

      const coinSignal = signals?.signals?.find((s: any) => s.symbol === trade.symbol);
      const coinSentiment = sentiment?.sentiment?.find((s: any) => s.symbol === trade.symbol);

      profitablePositions.push({
        trade,
        currentPrice,
        pnlPct: parseFloat(pnlPct.toFixed(2)),
        peakPnlPct: parseFloat(peakPnlPct.toFixed(2)),
        tpProgress: parseFloat(tpProgress.toFixed(1)),
        holdTimeMin: Math.round(
          (Date.now() - new Date(trade.timestamp_open).getTime()) / 60000
        ),
        indicators: coinSignal ? {
          composite_score: coinSignal.analysis?.composite_score,
          rsi: coinSignal.analysis?.rsi?.value,
          macd_signal: coinSignal.analysis?.macd?.signal,
          bollinger_position: coinSignal.analysis?.bollinger?.position,
          ma_signal: coinSignal.analysis?.ma?.signal,
        } : null,
        sentiment: coinSentiment ? {
          funding_rate: coinSentiment.hl?.funding,
          crowd_bias: coinSentiment.sentiment_summary?.crowd_bias,
          taker_pressure: coinSentiment.sentiment_summary?.taker_pressure,
        } : null,
      });
    }
  }

  if (profitablePositions.length === 0) {
    console.log(JSON.stringify({
      checked: openTrades.length,
      closed: 0,
      decisions: [],
      message: `수익 ${minProfitPct}% 이상 포지션 없음`,
    }));
    closeDb();
    return;
  }

  // AI 판단용 요약 출력
  const summary = {
    _instruction: `아래는 현재 수익 중인 포지션 목록이다. 각 포지션에 대해 "지금 익절할지" 판단하라.

[판단 기준]
1. 수익이 peak에서 하락 추세면 → 익절 (수익 보호)
2. 반대 방향 시그널(composite_score)이 나오면 → 익절 (반전 징후)
3. RSI가 과매수(>70, LONG)/과매도(<30, SHORT) 영역이면 → 익절 고려
4. TP 진행률이 70% 이상인데 모멘텀이 약해지면 → 익절
5. 펀딩비가 포지션 반대 방향으로 극단적이면 → 익절 고려
6. 보유 시간이 길고 모멘텀이 없으면 → 익절

[출력 형식 - JSON 배열만 출력, 다른 텍스트 금지]
[{"symbol":"BTC","action":"CLOSE","reason":"근거"},{"symbol":"ETH","action":"HOLD","reason":"근거"}]
action은 "CLOSE" 또는 "HOLD"만 허용.`,
    positions: profitablePositions.map(p => ({
      symbol: p.trade.symbol,
      side: p.trade.side,
      entry_price: p.trade.entry_price,
      current_price: p.currentPrice,
      pnl_pct: p.pnlPct,
      peak_pnl_pct: p.peakPnlPct,
      tp_progress: `${p.tpProgress}%`,
      hold_time_min: p.holdTimeMin,
      stop_loss: p.trade.stop_loss,
      take_profit: p.trade.take_profit,
      indicators: p.indicators,
      sentiment: p.sentiment,
    })),
  };

  console.log(JSON.stringify(summary, null, 2));
  closeDb();
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err.message }));
  closeDb();
  process.exit(1);
});
