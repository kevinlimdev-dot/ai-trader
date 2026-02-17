/**
 * AI 투자 판단용 데이터 요약 스크립트
 *
 * 기술적 분석 + 시장 심리 + 현재 포지션 + 잔고를 읽어서
 * AI(OpenClaw)가 자율적으로 판단할 수 있는 요약 리포트를 stdout에 출력한다.
 *
 * 사용법:
 *   bun run skills/ai-decision/scripts/summarize.ts
 */

import { resolve } from "path";
import { existsSync, readFileSync } from "fs";
import { getProjectRoot, loadConfig, getStrategy } from "../../../src/utils/config";
import { getStrategyPreset } from "../../../src/strategies/presets";
import { getOpenTrades, closeDb } from "../../../src/db/repository";

const root = getProjectRoot();

function readJson(path: string): any {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf-8")); } catch { return null; }
}

async function main() {
  const config = loadConfig();
  const strategyName = getStrategy();
  const preset = getStrategyPreset(strategyName);

  // 1. 시그널 읽기
  const signals = readJson(resolve(root, "data/signals/latest.json"));
  if (!signals?.signals) {
    console.log(JSON.stringify({ error: "분석 결과 없음. analyze.ts를 먼저 실행하세요." }));
    process.exit(1);
  }

  // 2. 현재 오픈 포지션
  const openTrades = getOpenTrades();

  // 3. 스냅샷 (최신 가격)
  const snapshots = readJson(resolve(root, "data/snapshots/latest.json"));

  // 4. 시장 심리 데이터
  const sentiment = readJson(resolve(root, "data/sentiment/latest.json"));
  const sentimentMap = new Map<string, any>();
  if (sentiment?.sentiment) {
    for (const s of sentiment.sentiment) {
      sentimentMap.set(s.symbol, s);
    }
  }

  // 5. 요약 생성
  const activeSignals = signals.signals.filter((s: any) => s.action !== "HOLD");
  const holdSignals = signals.signals.filter((s: any) => s.action === "HOLD");

  const summary: any = {
    _instruction: `너는 자율적인 AI 투자 판단자야. 아래 데이터를 종합 분석하고 독립적으로 투자 결정을 내려.
기술적 지표뿐 아니라 시장 심리(market_sentiment)도 반드시 고려해.
- 군중이 한 방향에 치우쳐 있으면 역발상 진입을 고려해 (contrarian)
- 스마트 머니(탑 트레이더)의 방향에 가중치를 둬
- 펀딩비가 극단적이면 반대 방향 포지션이 유리할 수 있어
- OI가 높으면서 가격이 떨어지면 숏 스퀴즈 가능성을 고려해
- 테이커 매수/매도 압력으로 단기 모멘텀을 판단해
결정은 apply-decision.ts로 적용한다.`,
    strategy: {
      name: strategyName,
      label: preset.label,
      leverage: preset.trade.leverage.default,
      risk_per_trade: preset.trade.risk.risk_per_trade,
      max_positions: preset.trade.risk.max_concurrent_positions,
      entry_threshold: preset.analysis.entry_threshold,
    },
    account: {
      open_positions: openTrades.length,
      max_positions: preset.trade.risk.max_concurrent_positions,
      available_slots: Math.max(0, preset.trade.risk.max_concurrent_positions - openTrades.length),
    },
    current_positions: openTrades.map((t) => ({
      symbol: t.symbol,
      side: t.side,
      entry_price: t.entry_price,
      size: t.size,
      leverage: t.leverage,
      stop_loss: t.stop_loss,
      take_profit: t.take_profit,
    })),
    market_overview: sentiment ? {
      collected_at: sentiment.collected_at,
      mood: (() => {
        const bullish = sentiment.sentiment.filter((s: any) => s.sentiment_summary?.overall?.includes("bullish")).length;
        const bearish = sentiment.sentiment.filter((s: any) => s.sentiment_summary?.overall?.includes("bearish")).length;
        return {
          bullish_coins: bullish,
          bearish_coins: bearish,
          neutral_coins: sentiment.count - bullish - bearish,
          overall: bullish > bearish * 1.5 ? "bullish" : bearish > bullish * 1.5 ? "bearish" : "mixed",
        };
      })(),
    } : { note: "시장 심리 데이터 없음. collect-sentiment.ts를 먼저 실행하세요." },
    analysis_time: signals.generated_at,
    candidates: activeSignals.map((s: any) => {
      const snap = snapshots?.snapshots?.find((sp: any) => sp.symbol === s.symbol);
      const alreadyOpen = openTrades.find((t) => t.symbol === s.symbol);
      const coinSentiment = sentimentMap.get(s.symbol);

      return {
        symbol: s.symbol,
        recommended_action: s.action,
        confidence: s.confidence,
        entry_price: s.entry_price,
        stop_loss: s.stop_loss,
        take_profit: s.take_profit,
        risk_reward_ratio: s.risk?.risk_reward_ratio,
        composite_score: s.analysis?.composite_score,
        indicators: {
          spread: s.analysis?.spread?.signal,
          spread_pct: s.analysis?.spread?.value_pct,
          rsi: `${s.analysis?.rsi?.signal} (${s.analysis?.rsi?.value?.toFixed(1)})`,
          macd: s.analysis?.macd?.signal,
          bollinger: `${s.analysis?.bollinger?.signal} (${s.analysis?.bollinger?.position})`,
          ma: s.analysis?.ma?.signal,
        },
        market_sentiment: coinSentiment ? {
          funding_rate: coinSentiment.hl?.funding,
          open_interest: coinSentiment.hl?.openInterest,
          premium: coinSentiment.hl?.premium,
          day_volume_usd: coinSentiment.hl?.dayNtlVlm,
          crowd_bias: coinSentiment.sentiment_summary?.crowd_bias,
          smart_money: coinSentiment.sentiment_summary?.smart_money_bias,
          taker_pressure: coinSentiment.sentiment_summary?.taker_pressure,
          overall_sentiment: coinSentiment.sentiment_summary?.overall,
          long_short_ratio: coinSentiment.binance?.longShortRatio?.latest,
          top_trader_ratio: coinSentiment.binance?.topTraderRatio?.latest,
        } : null,
        current_hl_price: snap?.hyperliquid?.mid_price || null,
        current_binance_price: snap?.binance?.mark_price || null,
        already_open: alreadyOpen ? `${alreadyOpen.side} @ ${alreadyOpen.entry_price}` : null,
      };
    }),
    hold_count: holdSignals.length,
    hold_symbols: holdSignals.map((s: any) => s.symbol).join(", "),
  };

  console.log(JSON.stringify(summary, null, 2));
  closeDb();
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
});
