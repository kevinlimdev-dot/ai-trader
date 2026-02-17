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
import { getOpenTrades, getRecentClosedTrades, getPerformanceStats, closeDb } from "../../../src/db/repository";

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

  // 5. 과거 성과 데이터
  const perfStats = getPerformanceStats(7);
  const recentTrades = getRecentClosedTrades(20);

  // 최근 5거래의 간략한 결과
  const recentTradesSummary = recentTrades.slice(0, 10).map((t) => ({
    symbol: t.symbol,
    side: t.side,
    pnl: t.pnl ? parseFloat(t.pnl.toFixed(2)) : 0,
    pnl_pct: t.pnl_pct ? parseFloat(t.pnl_pct.toFixed(2)) : 0,
    exit_reason: t.exit_reason || "unknown",
    hold_time_min: t.timestamp_close && t.timestamp_open
      ? Math.round((new Date(t.timestamp_close).getTime() - new Date(t.timestamp_open).getTime()) / 60000)
      : 0,
  }));

  // 6. 요약 생성
  const activeSignals = signals.signals.filter((s: any) => s.action !== "HOLD");
  const holdSignals = signals.signals.filter((s: any) => s.action === "HOLD");

  const summary: any = {
    _instruction: `너는 자율적인 AI 투자 판단자야. 아래 데이터를 종합 분석하고 독립적으로 투자 결정을 내려.

[분석 원칙]
1. 멀티타임프레임 합류: 4h 추세 방향과 15m 진입 타이밍이 일치할 때만 진입
2. 기술적 지표 + 시장 심리를 반드시 교차 확인
3. 군중이 한 방향에 치우쳐 있으면 역발상 진입 (contrarian)
4. 스마트 머니(탑 트레이더) 방향에 가중치
5. 펀딩비가 극단적이면 반대 방향 포지션이 유리
6. OI가 높으면서 가격이 떨어지면 숏 스퀴즈 가능성 고려
7. 테이커 매수/매도 압력으로 단기 모멘텀 판단

[과거 성과 기반 판단]
- 최근 7일 승률과 실적 데이터(historical_performance)를 반드시 참고해
- 연패 중이면 포지션 수/규모를 줄여
- 특정 코인에서 반복적으로 손실이 나면 해당 코인은 HOLD 처리
- 롱/숏 중 한쪽에서만 손실이 크면 해당 방향 진입에 더 높은 확신 요구
- 승률이 40% 미만이면 진입 기준을 더 보수적으로 적용

결정은 apply-decision.ts로 적용한다.`,
    strategy: {
      name: strategyName,
      label: preset.label,
      leverage: preset.trade.leverage.default,
      risk_per_trade: preset.trade.risk.risk_per_trade,
      max_positions: preset.trade.risk.max_concurrent_positions,
      entry_threshold: preset.analysis.signal.entry_threshold,
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
    historical_performance: {
      period: "최근 7일",
      total_trades: perfStats.total_trades,
      win_rate: parseFloat((perfStats.win_rate * 100).toFixed(1)) + "%",
      total_pnl: parseFloat(perfStats.total_pnl.toFixed(2)),
      avg_pnl_per_trade: parseFloat(perfStats.avg_pnl.toFixed(2)),
      avg_win: parseFloat(perfStats.avg_win.toFixed(2)),
      avg_loss: parseFloat(perfStats.avg_loss.toFixed(2)),
      max_win: parseFloat(perfStats.max_win.toFixed(2)),
      max_loss: parseFloat(perfStats.max_loss.toFixed(2)),
      avg_hold_time_min: Math.round(perfStats.avg_hold_time_min),
      consecutive_losses: perfStats.consecutive_losses,
      pnl_by_side: {
        long: { count: perfStats.pnl_by_side.long_count, pnl: parseFloat(perfStats.pnl_by_side.long_pnl.toFixed(2)) },
        short: { count: perfStats.pnl_by_side.short_count, pnl: parseFloat(perfStats.pnl_by_side.short_pnl.toFixed(2)) },
      },
      best_symbols: perfStats.best_symbols.map((s) => `${s.symbol}(${s.count}회, $${s.pnl.toFixed(2)})`),
      worst_symbols: perfStats.worst_symbols.map((s) => `${s.symbol}(${s.count}회, $${s.pnl.toFixed(2)})`),
      recent_trades: recentTradesSummary,
    },
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
