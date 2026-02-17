/**
 * 시장 심리 데이터 수집 스크립트
 *
 * Binance: OI, 롱/숏 비율, 탑트레이더 포지션, 테이커 매수/매도
 * HyperLiquid: 펀딩비, OI, 프리미엄, 거래량 (metaAndAssetCtxs)
 *
 * 사용법:
 *   bun run skills/ai-decision/scripts/collect-sentiment.ts
 *   bun run skills/ai-decision/scripts/collect-sentiment.ts --symbols BTC,ETH,SOL
 */

import { resolve } from "path";
import { BinanceService } from "../../../src/services/binance.service";
import { HyperliquidService } from "../../../src/services/hyperliquid.service";
import { loadConfig, getProjectRoot } from "../../../src/utils/config";
import { atomicWrite } from "../../../src/utils/file";

const root = getProjectRoot();

function parseArgs(): { symbols?: string[] } {
  const args = process.argv.slice(2);
  const idx = args.indexOf("--symbols");
  if (idx >= 0 && args[idx + 1]) {
    return { symbols: args[idx + 1].split(",").map(s => s.trim().toUpperCase()) };
  }
  return {};
}

interface CoinSentiment {
  symbol: string;
  binance_pair: string;
  hl: {
    funding: number;
    openInterest: number;
    premium: number;
    oraclePx: number;
    markPx: number;
    dayNtlVlm: number;
    impactBid: number;
    impactAsk: number;
  } | null;
  binance: {
    openInterest: number | null;
    fundingHistory: Array<{ rate: number; time: number }>;
    longShortRatio: { latest: number; trend: string } | null;
    topTraderRatio: { latest: number; trend: string } | null;
    takerVolume: { buySellRatio: number; trend: string } | null;
  } | null;
  sentiment_summary: {
    funding_direction: string;
    oi_level: string;
    crowd_bias: string;
    smart_money_bias: string;
    taker_pressure: string;
    overall: string;
  };
}

function deriveSentiment(coin: CoinSentiment): CoinSentiment["sentiment_summary"] {
  const hl = coin.hl;
  const bn = coin.binance;

  // 펀딩비 방향
  let funding_direction = "neutral";
  if (hl) {
    if (hl.funding > 0.0001) funding_direction = "bullish_expensive";
    else if (hl.funding > 0.00005) funding_direction = "slightly_bullish";
    else if (hl.funding < -0.0001) funding_direction = "bearish_expensive";
    else if (hl.funding < -0.00005) funding_direction = "slightly_bearish";
  }

  // 롱숏 비율 (군중 편향)
  let crowd_bias = "unknown";
  if (bn?.longShortRatio) {
    const r = bn.longShortRatio.latest;
    if (r > 2.0) crowd_bias = "extreme_long";
    else if (r > 1.3) crowd_bias = "long_heavy";
    else if (r < 0.5) crowd_bias = "extreme_short";
    else if (r < 0.77) crowd_bias = "short_heavy";
    else crowd_bias = "balanced";
  }

  // 탑 트레이더 (스마트 머니)
  let smart_money_bias = "unknown";
  if (bn?.topTraderRatio) {
    const r = bn.topTraderRatio.latest;
    if (r > 2.0) smart_money_bias = "strong_long";
    else if (r > 1.3) smart_money_bias = "long_bias";
    else if (r < 0.5) smart_money_bias = "strong_short";
    else if (r < 0.77) smart_money_bias = "short_bias";
    else smart_money_bias = "neutral";
  }

  // 테이커 압력
  let taker_pressure = "unknown";
  if (bn?.takerVolume) {
    const r = bn.takerVolume.buySellRatio;
    if (r > 1.2) taker_pressure = "buy_dominant";
    else if (r > 1.05) taker_pressure = "slightly_buy";
    else if (r < 0.8) taker_pressure = "sell_dominant";
    else if (r < 0.95) taker_pressure = "slightly_sell";
    else taker_pressure = "balanced";
  }

  // OI 레벨
  let oi_level = "unknown";
  if (hl && hl.openInterest > 0 && hl.oraclePx > 0) {
    const oiNotional = hl.openInterest * hl.oraclePx;
    const volRatio = hl.dayNtlVlm > 0 ? oiNotional / hl.dayNtlVlm : 0;
    if (volRatio > 3) oi_level = "very_high";
    else if (volRatio > 1.5) oi_level = "high";
    else if (volRatio > 0.5) oi_level = "moderate";
    else oi_level = "low";
  }

  // 종합 판단
  let bullish = 0, bearish = 0;
  if (funding_direction.includes("bullish")) bullish++;
  if (funding_direction.includes("bearish")) bearish++;
  if (crowd_bias === "extreme_long" || crowd_bias === "long_heavy") bearish++; // 역발상
  if (crowd_bias === "extreme_short" || crowd_bias === "short_heavy") bullish++; // 역발상
  if (smart_money_bias.includes("long")) bullish++;
  if (smart_money_bias.includes("short")) bearish++;
  if (taker_pressure.includes("buy")) bullish++;
  if (taker_pressure.includes("sell")) bearish++;

  let overall = "neutral";
  if (bullish >= 3) overall = "strong_bullish";
  else if (bullish >= 2 && bearish === 0) overall = "bullish";
  else if (bearish >= 3) overall = "strong_bearish";
  else if (bearish >= 2 && bullish === 0) overall = "bearish";
  else if (bullish > bearish) overall = "slightly_bullish";
  else if (bearish > bullish) overall = "slightly_bearish";
  else overall = "mixed";

  return { funding_direction, oi_level, crowd_bias, smart_money_bias, taker_pressure, overall };
}

async function main() {
  const config = loadConfig();
  const args = parseArgs();

  let symbols = config.data_agent.symbols;
  if (args.symbols) {
    symbols = symbols.filter(s => args.symbols!.includes(s.symbol));
  }

  // 상위 20개만 (rate limit 고려, 나머지는 HL 데이터만)
  const topSymbols = symbols.slice(0, 20);

  const binance = new BinanceService();
  const hl = new HyperliquidService();

  // HyperLiquid: 한 번의 호출로 모든 코인 데이터
  const hlContexts = await hl.getMetaAndAssetCtxs();
  const hlMap = new Map(hlContexts.map(c => [c.coin, c]));

  const results: CoinSentiment[] = [];
  const errors: string[] = [];

  // Binance 심리 데이터 수집 (상위 20개만, rate limit 고려)
  for (const sym of topSymbols) {
    try {
      const hlData = hlMap.get(sym.symbol) || null;
      let bnData = null;

      try {
        bnData = await binance.getMarketSentiment(sym.binance_pair);
      } catch (err) {
        errors.push(`${sym.symbol} Binance: ${err instanceof Error ? err.message : String(err)}`);
      }

      const coin: CoinSentiment = {
        symbol: sym.symbol,
        binance_pair: sym.binance_pair,
        hl: hlData ? {
          funding: hlData.funding,
          openInterest: hlData.openInterest,
          premium: hlData.premium,
          oraclePx: hlData.oraclePx,
          markPx: hlData.markPx,
          dayNtlVlm: hlData.dayNtlVlm,
          impactBid: hlData.impactBid,
          impactAsk: hlData.impactAsk,
        } : null,
        binance: bnData,
        sentiment_summary: { funding_direction: "unknown", oi_level: "unknown", crowd_bias: "unknown", smart_money_bias: "unknown", taker_pressure: "unknown", overall: "unknown" },
      };

      coin.sentiment_summary = deriveSentiment(coin);
      results.push(coin);
    } catch (err) {
      errors.push(`${sym.symbol}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 나머지 심볼은 HL 데이터만
  for (const sym of symbols.slice(20)) {
    const hlData = hlMap.get(sym.symbol);
    if (hlData) {
      const coin: CoinSentiment = {
        symbol: sym.symbol,
        binance_pair: sym.binance_pair,
        hl: {
          funding: hlData.funding,
          openInterest: hlData.openInterest,
          premium: hlData.premium,
          oraclePx: hlData.oraclePx,
          markPx: hlData.markPx,
          dayNtlVlm: hlData.dayNtlVlm,
          impactBid: hlData.impactBid,
          impactAsk: hlData.impactAsk,
        },
        binance: null,
        sentiment_summary: { funding_direction: "unknown", oi_level: "unknown", crowd_bias: "unknown", smart_money_bias: "unknown", taker_pressure: "unknown", overall: "unknown" },
      };
      coin.sentiment_summary = deriveSentiment(coin);
      results.push(coin);
    }
  }

  // 파일 저장
  const output = {
    collected_at: new Date().toISOString(),
    count: results.length,
    sentiment: results,
  };

  await atomicWrite(resolve(root, "data/sentiment/latest.json"), output);

  // 마켓 전체 요약
  const overallBullish = results.filter(r => r.sentiment_summary.overall.includes("bullish")).length;
  const overallBearish = results.filter(r => r.sentiment_summary.overall.includes("bearish")).length;
  const overallNeutral = results.length - overallBullish - overallBearish;

  const marketSummary = {
    status: "success",
    collected: results.length,
    errors: errors.length > 0 ? errors : undefined,
    market_mood: {
      bullish_coins: overallBullish,
      bearish_coins: overallBearish,
      neutral_coins: overallNeutral,
      overall: overallBullish > overallBearish * 1.5 ? "bullish"
        : overallBearish > overallBullish * 1.5 ? "bearish"
        : "mixed",
    },
    top_bullish: results
      .filter(r => r.sentiment_summary.overall.includes("bullish"))
      .slice(0, 5)
      .map(r => `${r.symbol} (${r.sentiment_summary.overall})`),
    top_bearish: results
      .filter(r => r.sentiment_summary.overall.includes("bearish"))
      .slice(0, 5)
      .map(r => `${r.symbol} (${r.sentiment_summary.overall})`),
  };

  console.log(JSON.stringify(marketSummary, null, 2));
}

main().catch(err => {
  console.error(JSON.stringify({ status: "error", error: err instanceof Error ? err.message : String(err) }));
  process.exit(1);
});
