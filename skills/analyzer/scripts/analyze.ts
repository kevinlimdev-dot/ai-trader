/**
 * analyzer 스킬 스크립트 (v2 — 멀티타임프레임)
 *
 * 4개 타임프레임(1m, 15m, 1h, 4h) 캔들을 활용하여
 * 지표별 최적 타임프레임에서 분석하고, 가중 복합 스코어로 매매 시그널을 생성한다.
 *
 * 타임프레임별 역할:
 *   4h  → 상위 추세 방향 (MA, MACD)
 *   1h  → 중기 과매수/과매도 (RSI, Bollinger)
 *   15m → 진입 타이밍 (MACD 크로스, 모멘텀)
 *   1m  → 스프레드 분석 (바이낸스-HL 가격 차이)
 *
 * 사용법:
 *   bun run skills/analyzer/scripts/analyze.ts
 */

import { resolve } from "path";
import { existsSync, readFileSync } from "fs";
import { RSI, MACD, BollingerBands, SMA, EMA, ATR } from "technicalindicators";
import { loadConfig, getProjectRoot, getStrategy } from "../../../src/utils/config";
import { createLogger } from "../../../src/utils/logger";
import { atomicWrite } from "../../../src/utils/file";
import { getClosePrices, getLastSignalTime, closeDb } from "../../../src/db/repository";
import { getStrategyPreset, type AnalysisOverrides } from "../../../src/strategies/presets";
import type { SnapshotCollection, PriceSnapshot, CandleData } from "../../../src/models/price-snapshot";
import type {
  TradeSignal,
  SignalCollection,
  IndicatorSignal,
  AnalysisDetail,
} from "../../../src/models/trade-signal";

const logger = createLogger("Analyzer");

let strategyOverrides: AnalysisOverrides | null = null;

/** AI 조정값 (data/ai-adjustments.json) */
interface AiAdjustments {
  timestamp?: string;
  reason?: string;
  adjustments?: {
    entry_threshold?: { from: number; to: number };
    min_confidence?: { from: number; to: number };
    weights?: Record<string, { from: number; to: number }>;
  };
  market_condition?: string;
  action_taken?: string;
}

let aiAdjustments: AiAdjustments | null = null;

function loadAiAdjustments(root: string): AiAdjustments | null {
  const filePath = resolve(root, "data/ai-adjustments.json");
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf-8");
    const data: AiAdjustments = JSON.parse(raw);
    // 1시간 이내의 조정값만 적용
    if (data.timestamp) {
      const age = Date.now() - new Date(data.timestamp).getTime();
      if (age > 60 * 60 * 1000) {
        logger.debug("AI 조정값이 1시간 경과하여 무시합니다");
        return null;
      }
    }
    return data;
  } catch {
    return null;
  }
}

// ─── Graceful Shutdown ───
function setupGracefulShutdown(): void {
  const cleanup = () => { closeDb(); process.exit(0); };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

// ─── Score Map (BIAS를 0.5로 차별화) ───

const SCORE_MAP: Record<string, number> = {
  STRONG_LONG: 2,
  LONG: 1,
  LONG_BIAS: 0.5,
  NEUTRAL: 0,
  SHORT_BIAS: -0.5,
  SHORT: -1,
  STRONG_SHORT: -2,
};

// ─── 캔들에서 closes 추출 ───

function getCandleCloses(candles: CandleData[] | undefined): number[] {
  if (!candles || candles.length === 0) return [];
  return candles.map((c) => c.close);
}

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

// ─── Indicator Analysis (멀티타임프레임) ───

/** 스프레드: 실시간 (타임프레임 무관) — 전략 preset > config 우선순위 */
function analyzeSpread(snapshot: PriceSnapshot): IndicatorSignal {
  const config = loadConfig();
  const pct = snapshot.spread.percentage;
  const dir = snapshot.spread.direction;

  const thresholdHigh = strategyOverrides?.spread?.threshold_high ?? config.analysis_agent.spread.threshold_high;
  const thresholdExtreme = strategyOverrides?.spread?.threshold_extreme ?? config.analysis_agent.spread.threshold_extreme;

  if (pct < 0.0003) return "NEUTRAL"; // 0.03% 미만은 무의미

  if (dir === "binance_higher") {
    if (pct >= thresholdExtreme) return "STRONG_LONG";
    if (pct >= thresholdHigh) return "LONG";
    if (pct >= thresholdHigh * 0.5) return "LONG_BIAS";
    return "NEUTRAL";
  } else {
    if (pct >= thresholdExtreme) return "STRONG_SHORT";
    if (pct >= thresholdHigh) return "SHORT";
    if (pct >= thresholdHigh * 0.5) return "SHORT_BIAS";
    return "NEUTRAL";
  }
}

/** RSI: 1h 타임프레임 (중기 과매수/과매도) */
function analyzeRSI(closes1h: number[], closes15m: number[]): { value: number; value_15m: number; signal: IndicatorSignal } {
  const config = loadConfig();
  const period = config.analysis_agent.indicators.rsi.period;

  const overbought = strategyOverrides?.rsi.overbought ?? config.analysis_agent.indicators.rsi.overbought;
  const oversold = strategyOverrides?.rsi.oversold ?? config.analysis_agent.indicators.rsi.oversold;

  // 1h RSI (주 판단)
  let value1h = 50;
  if (closes1h.length >= period + 1) {
    const rsiValues = RSI.calculate({ values: closes1h, period });
    value1h = rsiValues[rsiValues.length - 1] ?? 50;
  }

  // 15m RSI (보조 확인)
  let value15m = 50;
  if (closes15m.length >= period + 1) {
    const rsiValues = RSI.calculate({ values: closes15m, period });
    value15m = rsiValues[rsiValues.length - 1] ?? 50;
  }

  let signal: IndicatorSignal = "NEUTRAL";

  // 1h + 15m 동시 과매수/과매도일 때 강한 시그널
  if (value1h <= oversold && value15m <= oversold + 5) signal = "STRONG_LONG";
  else if (value1h <= oversold) signal = "LONG";
  else if (value1h >= overbought && value15m >= overbought - 5) signal = "STRONG_SHORT";
  else if (value1h >= overbought) signal = "SHORT";
  else if (value1h <= oversold + 5) signal = "LONG_BIAS";
  else if (value1h >= overbought - 5) signal = "SHORT_BIAS";

  return { value: value1h, value_15m: value15m, signal };
}

/** MACD: 4h(추세) + 15m(타이밍) 듀얼 타임프레임 */
function analyzeMACD(
  closes4h: number[],
  closes15m: number[],
): { histogram_4h: number; histogram_15m: number; signal: IndicatorSignal } {
  const config = loadConfig();
  const { fast, slow, signal: sigPeriod } = config.analysis_agent.indicators.macd;

  const calcMACD = (closes: number[]) => {
    if (closes.length < slow + sigPeriod) return null;
    const result = MACD.calculate({
      values: closes,
      fastPeriod: fast,
      slowPeriod: slow,
      signalPeriod: sigPeriod,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });
    const latest = result[result.length - 1];
    const prev = result.length > 1 ? result[result.length - 2] : null;
    return { latest, prev };
  };

  const macd4h = calcMACD(closes4h);
  const macd15m = calcMACD(closes15m);

  const h4h = macd4h?.latest?.histogram ?? 0;
  const h15m = macd15m?.latest?.histogram ?? 0;

  let signal: IndicatorSignal = "NEUTRAL";

  // 4h 추세 방향 확인
  const trend4h = h4h > 0 ? "bull" : h4h < 0 ? "bear" : "flat";

  // 15m 크로스 확인
  const prev15m = macd15m?.prev?.histogram ?? 0;
  const cross15m = prev15m < 0 && h15m > 0 ? "golden" : prev15m > 0 && h15m < 0 ? "death" : "none";

  // 4h 추세 + 15m 크로스 합류
  if (trend4h === "bull" && cross15m === "golden") signal = "STRONG_LONG";
  else if (trend4h === "bull" && h15m > 0) signal = "LONG";
  else if (trend4h === "bear" && cross15m === "death") signal = "STRONG_SHORT";
  else if (trend4h === "bear" && h15m < 0) signal = "SHORT";
  else if (cross15m === "golden") signal = "LONG_BIAS";
  else if (cross15m === "death") signal = "SHORT_BIAS";
  else if (h4h > 0 && h15m > 0) signal = "LONG_BIAS";
  else if (h4h < 0 && h15m < 0) signal = "SHORT_BIAS";

  return { histogram_4h: h4h, histogram_15m: h15m, signal };
}

/** Bollinger Bands: 1h 타임프레임 */
function analyzeBollinger(closes1h: number[]): {
  upper: number;
  middle: number;
  lower: number;
  bandwidth: number;
  position: "above" | "upper" | "middle" | "lower" | "below";
  signal: IndicatorSignal;
} {
  const config = loadConfig();
  const { period, std_dev } = config.analysis_agent.indicators.bollinger;

  if (closes1h.length < period) {
    return { upper: 0, middle: 0, lower: 0, bandwidth: 0, position: "middle", signal: "NEUTRAL" };
  }

  const bb = BollingerBands.calculate({ values: closes1h, period, stdDev: std_dev });
  const latest = bb[bb.length - 1];
  if (!latest) {
    return { upper: 0, middle: 0, lower: 0, bandwidth: 0, position: "middle", signal: "NEUTRAL" };
  }

  const currentPrice = closes1h[closes1h.length - 1];
  const bandwidth = latest.middle > 0 ? (latest.upper - latest.lower) / latest.middle : 0;

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

  // 볼린저밴드 수축 시 변동성 확대 임박 → NEUTRAL (방향 불확실)
  if (bandwidth < 0.02) {
    signal = "NEUTRAL";
  }

  return { upper: latest.upper, middle: latest.middle, lower: latest.lower, bandwidth, position, signal };
}

/** 이동평균: 4h 타임프레임 (장기 추세 판단) */
function analyzeMA(closes4h: number[], closes1h: number[]): {
  ma7: number;
  ma25: number;
  ma99: number;
  ema21_1h: number;
  signal: IndicatorSignal;
} {
  const config = loadConfig();
  const { short: s, medium: m, long: l } = config.analysis_agent.indicators.ma;

  // 4h MA (장기 추세)
  const ma7 = closes4h.length >= s ? SMA.calculate({ values: closes4h, period: s }).pop() ?? 0 : 0;
  const ma25 = closes4h.length >= m ? SMA.calculate({ values: closes4h, period: m }).pop() ?? 0 : 0;
  const ma99 = closes4h.length >= l ? SMA.calculate({ values: closes4h, period: l }).pop() ?? 0 : 0;

  // 1h EMA21 (중기 추세 보조)
  const ema21_1h = closes1h.length >= 21 ? EMA.calculate({ values: closes1h, period: 21 }).pop() ?? 0 : 0;
  const currentPrice = closes1h.length > 0 ? closes1h[closes1h.length - 1] : 0;

  if (ma7 === 0 || ma25 === 0) {
    return { ma7, ma25, ma99, ema21_1h, signal: "NEUTRAL" };
  }

  let signal: IndicatorSignal;

  // 4h MA 정렬 + 1h 가격이 EMA21 위/아래
  const maAligned = ma7 > ma25 && (ma99 === 0 || ma25 > ma99);
  const maAlignedDown = ma7 < ma25 && (ma99 === 0 || ma25 < ma99);
  const priceAboveEma = ema21_1h > 0 && currentPrice > ema21_1h;
  const priceBelowEma = ema21_1h > 0 && currentPrice < ema21_1h;

  if (maAligned && priceAboveEma) signal = "STRONG_LONG";
  else if (maAligned) signal = "LONG";
  else if (maAlignedDown && priceBelowEma) signal = "STRONG_SHORT";
  else if (maAlignedDown) signal = "SHORT";
  else if (ma7 > ma25) signal = "LONG_BIAS";
  else if (ma7 < ma25) signal = "SHORT_BIAS";
  else signal = "NEUTRAL";

  return { ma7, ma25, ma99, ema21_1h, signal };
}

/** ATR: 1h 타임프레임 (변동성 기반 SL/TP에 적합) */
function calculateATR(candles: CandleData[], period: number): number {
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

  const maxScore = 2; // STRONG_LONG = 2
  return totalScore / (maxScore * totalWeight);
}

// ─── Main Analysis (멀티타임프레임) ───

function analyzeSymbol(snapshot: PriceSnapshot, historicalCloses: number[]): TradeSignal {
  const config = loadConfig();

  // 멀티타임프레임 캔들 추출
  const candles1m = snapshot.candles?.["1m"] || snapshot.candles_1m || [];
  const candles15m = snapshot.candles?.["15m"] || [];
  const candles1h = snapshot.candles?.["1h"] || [];
  const candles4h = snapshot.candles?.["4h"] || [];

  const closes1m = getCandleCloses(candles1m.length > 0 ? candles1m : undefined) || historicalCloses;
  const closes15m = getCandleCloses(candles15m.length > 0 ? candles15m : undefined);
  const closes1h = getCandleCloses(candles1h.length > 0 ? candles1h : undefined);
  const closes4h = getCandleCloses(candles4h.length > 0 ? candles4h : undefined);

  // 폴백: 멀티타임프레임이 없으면 1m 사용 (레거시 호환)
  const effectiveCloses15m = closes15m.length >= 30 ? closes15m : closes1m;
  const effectiveCloses1h = closes1h.length >= 30 ? closes1h : closes15m.length >= 30 ? closes15m : closes1m;
  const effectiveCloses4h = closes4h.length >= 30 ? closes4h : closes1h.length >= 30 ? closes1h : closes1m;

  // 각 지표별 최적 타임프레임에서 분석
  const spreadSignal = analyzeSpread(snapshot);
  const rsi = analyzeRSI(effectiveCloses1h, effectiveCloses15m);
  const macd = analyzeMACD(effectiveCloses4h, effectiveCloses15m);
  const bollinger = analyzeBollinger(effectiveCloses1h);
  const ma = analyzeMA(effectiveCloses4h, effectiveCloses1h);

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

  // ATR: 1h 캔들 기반 (더 안정적인 변동성 측정)
  const atrCandles = candles1h.length > 0 ? candles1h : candles15m.length > 0 ? candles15m : candles1m;
  const atr = atrCandles.length > 0
    ? calculateATR(atrCandles, config.analysis_agent.risk.atr_period)
    : Math.abs(snapshot.binance.mark_price * 0.005);

  const entryPrice = snapshot.hyperliquid.mid_price;

  // 전략 프리셋의 ATR multiplier 우선 사용, 없으면 config.yaml 폴백
  const preset = getStrategyPreset(getStrategy());
  const slMult = preset.trade.stopLoss.atr_multiplier ?? config.analysis_agent.risk.stop_loss_multiplier;
  const tpMult = preset.trade.takeProfit.atr_multiplier ?? config.analysis_agent.risk.take_profit_multiplier;

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
      histogram: macd.histogram_15m,
      macd_line: macd.histogram_4h,
      signal_line: 0,
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

  const strategyName = getStrategy();
  const preset = getStrategyPreset(strategyName);
  strategyOverrides = { ...preset.analysis };

  // AI 조정값 로드 및 머지 (preset 위에 덮어쓰기)
  aiAdjustments = loadAiAdjustments(root);
  if (aiAdjustments?.adjustments) {
    const adj = aiAdjustments.adjustments;
    if (adj.entry_threshold?.to !== undefined) {
      strategyOverrides = {
        ...strategyOverrides,
        signal: { ...strategyOverrides.signal, entry_threshold: adj.entry_threshold.to },
      };
      logger.info(`AI 조정 적용: entry_threshold ${adj.entry_threshold.from} → ${adj.entry_threshold.to}`);
    }
    if (adj.min_confidence?.to !== undefined) {
      strategyOverrides = {
        ...strategyOverrides,
        signal: { ...strategyOverrides.signal, min_confidence: adj.min_confidence.to },
      };
      logger.info(`AI 조정 적용: min_confidence ${adj.min_confidence.from} → ${adj.min_confidence.to}`);
    }
    if (adj.weights) {
      const mergedWeights = { ...strategyOverrides.weights };
      for (const [key, val] of Object.entries(adj.weights)) {
        if (val.to !== undefined) {
          (mergedWeights as any)[key] = val.to;
          logger.info(`AI 조정 적용: weight.${key} ${val.from} → ${val.to}`);
        }
      }
      strategyOverrides = { ...strategyOverrides, weights: mergedWeights };
    }
    logger.info(`AI 조정값 머지 완료 (사유: ${aiAdjustments.reason || "N/A"})`);
  }

  logger.info(`전략 프리셋 적용: ${preset.label} (${preset.name})`, {
    entry_threshold: strategyOverrides.signal.entry_threshold,
    rsi: `${strategyOverrides.rsi.oversold}-${strategyOverrides.rsi.overbought}`,
    weights: JSON.stringify(strategyOverrides.weights),
  });

  const snapshotPath = resolve(root, "data/snapshots/latest.json");

  if (!existsSync(snapshotPath)) {
    console.error(JSON.stringify({
      status: "error",
      error: "스냅샷 파일이 없습니다. data-collector를 먼저 실행하세요.",
    }));
    process.exit(1);
  }

  const raw = readFileSync(snapshotPath, "utf-8");
  const collection: SnapshotCollection = JSON.parse(raw);

  const age = Date.now() - new Date(collection.collected_at).getTime();
  if (age > 5 * 60 * 1000) {
    logger.warn("스냅샷이 5분 이상 오래되었습니다", { age_seconds: Math.floor(age / 1000) });
  }

  const signals: TradeSignal[] = [];
  const cooldownSeconds = strategyOverrides?.signal.cooldown_seconds ?? config.analysis_agent.signal.cooldown_seconds;
  const skippedCooldown: string[] = [];

  for (const snapshot of collection.snapshots) {
    if (isInCooldown(snapshot.symbol, cooldownSeconds)) {
      skippedCooldown.push(snapshot.symbol);
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

    const historicalCloses = getClosePrices(snapshot.symbol, 100);
    const signal = analyzeSymbol(snapshot, historicalCloses);
    signals.push(signal);

    logger.info(`${snapshot.symbol} 분석 완료`, {
      action: signal.action,
      confidence: signal.confidence.toFixed(2),
      composite: signal.analysis.composite_score.toFixed(3),
      spread: `${(signal.analysis.spread.value_pct * 100).toFixed(4)}%`,
      timeframes: `4h:${snapshot.candles?.["4h"]?.length ?? 0} 1h:${snapshot.candles?.["1h"]?.length ?? 0} 15m:${snapshot.candles?.["15m"]?.length ?? 0}`,
    });
  }

  const signalCollection: SignalCollection = {
    generated_at: new Date().toISOString(),
    signals,
  };

  const signalPath = resolve(root, "data/signals/latest.json");
  await atomicWrite(signalPath, signalCollection);

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
