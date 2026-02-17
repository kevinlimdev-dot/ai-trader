/**
 * analyzer 스킬 스크립트
 * 가격 스냅샷을 분석하여 매매 시그널(LONG/SHORT/HOLD)을 생성한다.
 *
 * 사용법:
 *   bun run skills/analyzer/scripts/analyze.ts
 */

import { resolve } from "path";
import { existsSync, readFileSync } from "fs";
import { RSI, MACD, BollingerBands, SMA, ATR } from "technicalindicators";
import { loadConfig, getProjectRoot, getStrategy } from "../../../src/utils/config";
import { createLogger } from "../../../src/utils/logger";
import { atomicWrite } from "../../../src/utils/file";
import { getClosePrices, getLastSignalTime, closeDb } from "../../../src/db/repository";
import { getStrategyPreset, type AnalysisOverrides } from "../../../src/strategies/presets";
import type { SnapshotCollection, PriceSnapshot } from "../../../src/models/price-snapshot";
import type {
  TradeSignal,
  SignalCollection,
  IndicatorSignal,
  AnalysisDetail,
} from "../../../src/models/trade-signal";

const logger = createLogger("Analyzer");

// ─── Strategy Overrides (initialized in main) ───
let strategyOverrides: AnalysisOverrides | null = null;

// ─── Graceful Shutdown ───
function setupGracefulShutdown(): void {
  const cleanup = () => { closeDb(); process.exit(0); };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

// ─── Score Map ───

const SCORE_MAP: Record<string, number> = {
  STRONG_LONG: 2,
  LONG: 1,
  LONG_BIAS: 1,
  NEUTRAL: 0,
  SHORT_BIAS: -1,
  SHORT: -1,
  STRONG_SHORT: -2,
};

// ─── Cooldown Check ───

function isInCooldown(symbol: string, cooldownSeconds: number): boolean {
  const lastTime = getLastSignalTime(symbol);
  if (!lastTime) return false;

  const elapsed = (Date.now() - new Date(lastTime).getTime()) / 1000;
  if (elapsed < cooldownSeconds) {
    logger.info(`${symbol} 쿨다운 중 (${elapsed.toFixed(0)}s / ${cooldownSeconds}s)`);
    return true;
  }

  return false;
}

// ─── Indicator Analysis ───

function analyzeSpread(snapshot: PriceSnapshot): IndicatorSignal {
  const config = loadConfig();
  const pct = snapshot.spread.percentage;
  const dir = snapshot.spread.direction;

  if (pct < 0.001) return "NEUTRAL";

  if (dir === "binance_higher") {
    if (pct >= config.analysis_agent.spread.threshold_extreme) return "STRONG_LONG";
    if (pct >= config.analysis_agent.spread.threshold_high) return "LONG";
    return "LONG_BIAS";
  } else {
    if (pct >= config.analysis_agent.spread.threshold_extreme) return "STRONG_SHORT";
    if (pct >= config.analysis_agent.spread.threshold_high) return "SHORT";
    return "SHORT_BIAS";
  }
}

function analyzeRSI(closes: number[]): { value: number; signal: IndicatorSignal } {
  const config = loadConfig();
  const period = config.analysis_agent.indicators.rsi.period;

  if (closes.length < period + 1) {
    return { value: 50, signal: "NEUTRAL" };
  }

  const rsiValues = RSI.calculate({ values: closes, period });
  const value = rsiValues[rsiValues.length - 1] ?? 50;

  const overbought = strategyOverrides?.rsi.overbought ?? config.analysis_agent.indicators.rsi.overbought;
  const oversold = strategyOverrides?.rsi.oversold ?? config.analysis_agent.indicators.rsi.oversold;

  let signal: IndicatorSignal = "NEUTRAL";
  if (value <= oversold) signal = "LONG";
  else if (value >= overbought) signal = "SHORT";

  return { value, signal };
}

function analyzeMACD(closes: number[]): { histogram: number; macdLine: number; signalLine: number; signal: IndicatorSignal } {
  const config = loadConfig();
  const { fast, slow, signal: sigPeriod } = config.analysis_agent.indicators.macd;

  if (closes.length < slow + sigPeriod) {
    return { histogram: 0, macdLine: 0, signalLine: 0, signal: "NEUTRAL" };
  }

  const macdResult = MACD.calculate({
    values: closes,
    fastPeriod: fast,
    slowPeriod: slow,
    signalPeriod: sigPeriod,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });

  const latest = macdResult[macdResult.length - 1];
  const prev = macdResult.length > 1 ? macdResult[macdResult.length - 2] : null;

  if (!latest || latest.histogram === undefined) {
    return { histogram: 0, macdLine: 0, signalLine: 0, signal: "NEUTRAL" };
  }

  let signal: IndicatorSignal = "NEUTRAL";

  // 골든크로스 / 데드크로스
  if (prev && prev.histogram !== undefined) {
    if (prev.histogram < 0 && latest.histogram > 0) signal = "LONG";
    else if (prev.histogram > 0 && latest.histogram < 0) signal = "SHORT";
    else if (latest.histogram > 0) signal = "LONG_BIAS";
    else if (latest.histogram < 0) signal = "SHORT_BIAS";
  }

  return {
    histogram: latest.histogram,
    macdLine: latest.MACD ?? 0,
    signalLine: latest.signal ?? 0,
    signal,
  };
}

function analyzeBollinger(closes: number[]): {
  upper: number;
  middle: number;
  lower: number;
  position: "above" | "upper" | "middle" | "lower" | "below";
  signal: IndicatorSignal;
} {
  const config = loadConfig();
  const { period, std_dev } = config.analysis_agent.indicators.bollinger;

  if (closes.length < period) {
    return { upper: 0, middle: 0, lower: 0, position: "middle", signal: "NEUTRAL" };
  }

  const bb = BollingerBands.calculate({
    values: closes,
    period,
    stdDev: std_dev,
  });

  const latest = bb[bb.length - 1];
  if (!latest) {
    return { upper: 0, middle: 0, lower: 0, position: "middle", signal: "NEUTRAL" };
  }

  const currentPrice = closes[closes.length - 1];
  let position: "above" | "upper" | "middle" | "lower" | "below";
  let signal: IndicatorSignal;

  if (currentPrice <= latest.lower) {
    position = "below";
    signal = "LONG";
  } else if (currentPrice >= latest.upper) {
    position = "above";
    signal = "SHORT";
  } else if (currentPrice < latest.middle) {
    position = "lower";
    signal = "LONG_BIAS";
  } else if (currentPrice > latest.middle) {
    position = "upper";
    signal = "SHORT_BIAS";
  } else {
    position = "middle";
    signal = "NEUTRAL";
  }

  return { upper: latest.upper, middle: latest.middle, lower: latest.lower, position, signal };
}

function analyzeMA(closes: number[]): {
  ma7: number;
  ma25: number;
  ma99: number;
  signal: IndicatorSignal;
} {
  const config = loadConfig();
  const { short: s, medium: m, long: l } = config.analysis_agent.indicators.ma;

  const ma7 = closes.length >= s ? SMA.calculate({ values: closes, period: s }).pop() ?? 0 : 0;
  const ma25 = closes.length >= m ? SMA.calculate({ values: closes, period: m }).pop() ?? 0 : 0;
  const ma99 = closes.length >= l ? SMA.calculate({ values: closes, period: l }).pop() ?? 0 : 0;

  if (ma7 === 0 || ma25 === 0 || ma99 === 0) {
    return { ma7, ma25, ma99, signal: "NEUTRAL" };
  }

  let signal: IndicatorSignal;

  if (ma7 > ma25 && ma25 > ma99) signal = "STRONG_LONG";
  else if (ma7 > ma25) signal = "LONG";
  else if (ma7 < ma25 && ma25 < ma99) signal = "STRONG_SHORT";
  else if (ma7 < ma25) signal = "SHORT";
  else signal = "NEUTRAL";

  return { ma7, ma25, ma99, signal };
}

function calculateATR(candles: { high: number; low: number; close: number }[], period: number): number {
  if (candles.length < period + 1) return 0;

  const result = ATR.calculate({
    high: candles.map((c) => c.high),
    low: candles.map((c) => c.low),
    close: candles.map((c) => c.close),
    period,
  });

  return result[result.length - 1] ?? 0;
}

// ─── Composite Score ───

function computeCompositeScore(
  signals: Record<string, IndicatorSignal>,
): number {
  const config = loadConfig();
  const weights = strategyOverrides?.weights ?? config.analysis_agent.weights;

  let totalScore = 0;
  let totalWeight = 0;

  for (const [key, weight] of Object.entries(weights)) {
    const signal = signals[key];
    if (signal && SCORE_MAP[signal] !== undefined) {
      totalScore += SCORE_MAP[signal] * weight;
      totalWeight += weight;
    }
  }

  if (totalWeight === 0) return 0;

  // 정규화: -1 ~ 1
  const maxScore = 2; // STRONG_LONG = 2
  return totalScore / (maxScore * totalWeight);
}

// ─── Main Analysis ───

function analyzeSymbol(snapshot: PriceSnapshot, historicalCloses: number[]): TradeSignal {
  const config = loadConfig();

  // 캔들에서 close 데이터 추가
  const closes =
    snapshot.candles_1m && snapshot.candles_1m.length > 0
      ? snapshot.candles_1m.map((c) => c.close)
      : historicalCloses;

  // 각 지표 분석
  const spreadSignal = analyzeSpread(snapshot);
  const rsi = analyzeRSI(closes);
  const macd = analyzeMACD(closes);
  const bollinger = analyzeBollinger(closes);
  const ma = analyzeMA(closes);

  // 복합 점수
  const signals: Record<string, IndicatorSignal> = {
    spread: spreadSignal,
    rsi: rsi.signal,
    macd: macd.signal,
    bollinger: bollinger.signal,
    ma: ma.signal,
  };

  const compositeScore = computeCompositeScore(signals);

  // 시그널 결정
  let action: "LONG" | "SHORT" | "HOLD" = "HOLD";
  const threshold = strategyOverrides?.signal.entry_threshold ?? config.analysis_agent.signal.entry_threshold;

  if (compositeScore >= threshold) action = "LONG";
  else if (compositeScore <= -threshold) action = "SHORT";

  // ATR 기반 손절/익절
  const candles = snapshot.candles_1m || [];
  const atr = candles.length > 0
    ? calculateATR(candles, config.analysis_agent.risk.atr_period)
    : Math.abs(snapshot.binance.mark_price * 0.005); // fallback: 0.5%

  const entryPrice = snapshot.hyperliquid.mid_price;
  const slMult = config.analysis_agent.risk.stop_loss_multiplier;
  const tpMult = config.analysis_agent.risk.take_profit_multiplier;

  let stopLoss: number;
  let takeProfit: number;

  if (action === "LONG") {
    stopLoss = entryPrice - atr * slMult;
    takeProfit = entryPrice + atr * tpMult;
  } else if (action === "SHORT") {
    stopLoss = entryPrice + atr * slMult;
    takeProfit = entryPrice - atr * tpMult;
  } else {
    stopLoss = entryPrice;
    takeProfit = entryPrice;
  }

  const rrRatio = atr > 0 ? tpMult / slMult : 0;
  const confidence = Math.min(Math.abs(compositeScore), 1);

  const analysis: AnalysisDetail = {
    spread: {
      value_pct: snapshot.spread.percentage,
      direction: snapshot.spread.direction,
      signal: spreadSignal,
    },
    rsi: { value: rsi.value, signal: rsi.signal },
    macd: {
      histogram: macd.histogram,
      macd_line: macd.macdLine,
      signal_line: macd.signalLine,
      signal: macd.signal,
    },
    bollinger: {
      upper: bollinger.upper,
      middle: bollinger.middle,
      lower: bollinger.lower,
      position: bollinger.position,
      signal: bollinger.signal,
    },
    ma: { ma_7: ma.ma7, ma_25: ma.ma25, ma_99: ma.ma99, signal: ma.signal },
    composite_score: compositeScore,
  };

  return {
    timestamp: new Date().toISOString(),
    symbol: snapshot.symbol,
    action,
    confidence,
    entry_price: entryPrice,
    stop_loss: stopLoss,
    take_profit: takeProfit,
    analysis,
    risk: {
      risk_reward_ratio: rrRatio,
      max_position_pct: config.trade_agent.risk.max_position_pct,
      atr,
    },
  };
}

async function main(): Promise<void> {
  setupGracefulShutdown();

  const config = loadConfig();
  const root = getProjectRoot();

  // 전략 프리셋 로드
  const strategyName = getStrategy();
  const preset = getStrategyPreset(strategyName);
  strategyOverrides = preset.analysis;
  logger.info(`전략 프리셋 적용: ${preset.label} (${preset.name})`, {
    entry_threshold: preset.analysis.signal.entry_threshold,
    rsi: `${preset.analysis.rsi.oversold}-${preset.analysis.rsi.overbought}`,
    weights: JSON.stringify(preset.analysis.weights),
  });

  const snapshotPath = resolve(root, "data/snapshots/latest.json");

  // 스냅샷 읽기
  if (!existsSync(snapshotPath)) {
    console.error(JSON.stringify({
      status: "error",
      error: "스냅샷 파일이 없습니다. data-collector를 먼저 실행하세요.",
    }));
    process.exit(1);
  }

  const raw = readFileSync(snapshotPath, "utf-8");
  const collection: SnapshotCollection = JSON.parse(raw);

  // 신선도 체크 (5분 이상 오래된 데이터는 경고)
  const age = Date.now() - new Date(collection.collected_at).getTime();
  if (age > 5 * 60 * 1000) {
    logger.warn("스냅샷이 5분 이상 오래되었습니다", { age_seconds: Math.floor(age / 1000) });
  }

  const signals: TradeSignal[] = [];
  const cooldownSeconds = strategyOverrides?.signal.cooldown_seconds ?? config.analysis_agent.signal.cooldown_seconds;
  const skippedCooldown: string[] = [];

  for (const snapshot of collection.snapshots) {
    // 쿨다운 체크
    if (isInCooldown(snapshot.symbol, cooldownSeconds)) {
      skippedCooldown.push(snapshot.symbol);
      // 쿨다운 중에는 HOLD 시그널 생성
      signals.push({
        timestamp: new Date().toISOString(),
        symbol: snapshot.symbol,
        action: "HOLD",
        confidence: 0,
        entry_price: snapshot.hyperliquid.mid_price,
        stop_loss: snapshot.hyperliquid.mid_price,
        take_profit: snapshot.hyperliquid.mid_price,
        analysis: {
          spread: { value_pct: snapshot.spread.percentage, direction: snapshot.spread.direction, signal: "NEUTRAL" },
          rsi: { value: 50, signal: "NEUTRAL" },
          macd: { histogram: 0, macd_line: 0, signal_line: 0, signal: "NEUTRAL" },
          bollinger: { upper: 0, middle: 0, lower: 0, position: "middle", signal: "NEUTRAL" },
          ma: { ma_7: 0, ma_25: 0, ma_99: 0, signal: "NEUTRAL" },
          composite_score: 0,
        },
        risk: { risk_reward_ratio: 0, max_position_pct: 0, atr: 0 },
      });
      continue;
    }

    // DB에서 이력 데이터 가져오기 (캔들이 없는 경우)
    const historicalCloses = getClosePrices(snapshot.symbol, 100);

    const signal = analyzeSymbol(snapshot, historicalCloses);
    signals.push(signal);

    logger.info(`${snapshot.symbol} 분석 완료`, {
      action: signal.action,
      confidence: signal.confidence.toFixed(2),
      composite: signal.analysis.composite_score.toFixed(3),
      spread: `${(signal.analysis.spread.value_pct * 100).toFixed(4)}%`,
    });
  }

  // 시그널 파일 저장
  const signalCollection: SignalCollection = {
    generated_at: new Date().toISOString(),
    signals,
  };

  const signalPath = resolve(root, "data/signals/latest.json");
  await atomicWrite(signalPath, signalCollection);

  // stdout 결과
  const result = {
    status: "success",
    analyzed: signals.length,
    cooldown_skipped: skippedCooldown.length > 0 ? skippedCooldown : undefined,
    signals: signals.map((s) => ({
      symbol: s.symbol,
      action: s.action,
      confidence: parseFloat(s.confidence.toFixed(2)),
      composite_score: parseFloat(s.analysis.composite_score.toFixed(3)),
      entry_price: s.entry_price,
      stop_loss: parseFloat(s.stop_loss.toFixed(2)),
      take_profit: parseFloat(s.take_profit.toFixed(2)),
    })),
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({
    status: "error",
    error: err instanceof Error ? err.message : String(err),
    retryable: true,
  }));
  process.exit(1);
});
