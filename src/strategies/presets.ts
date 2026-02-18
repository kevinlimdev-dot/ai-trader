/**
 * 투자 전략 프리셋 정의
 *
 * 각 프리셋은 분석(analysis) + 거래(trade) 파라미터를 패키지로 제공한다.
 * config.yaml의 general.strategy 값으로 프리셋을 선택하면
 * analyzer와 trader가 해당 파라미터를 자동 적용한다.
 */

export type StrategyName = "conservative" | "balanced" | "aggressive";

export interface AnalysisOverrides {
  weights: {
    spread: number;
    rsi: number;
    macd: number;
    bollinger: number;
    ma: number;
  };
  rsi: {
    overbought: number;
    oversold: number;
  };
  spread: {
    threshold_high: number;
    threshold_extreme: number;
  };
  signal: {
    entry_threshold: number;
    min_confidence: number;
    cooldown_seconds: number;
  };
}

export interface TradeOverrides {
  leverage: {
    default: number;
    max: number;
  };
  risk: {
    risk_per_trade: number;
    max_position_pct: number;
    max_daily_loss: number;
    max_concurrent_positions: number;
    max_daily_trades: number;
    min_signal_confidence: number;
  };
  stopLoss: {
    atr_multiplier: number;
  };
  takeProfit: {
    atr_multiplier: number;
  };
  trailing_stop: {
    activation_pct: number;
    trail_pct: number;
  };
  progressive_trailing: {
    tiers: { profit_pct: number; trail_pct: number }[];
  };
  smart_tp: {
    min_profit_pct: number;
    check_interval_sec: number;
  };
  signal_max_age_seconds: number;
}

export interface StrategyPreset {
  name: StrategyName;
  label: string;
  description: string;
  analysis: AnalysisOverrides;
  trade: TradeOverrides;
}

// ─── Conservative (보수적) ───
// 높은 진입 장벽, 넓은 SL, R:R 2.5, 멀티타임프레임 추세 합류만 진입

const conservative: StrategyPreset = {
  name: "conservative",
  label: "Conservative",
  description: "높은 진입 장벽, 넓은 SL, 자본 보존 우선 (R:R 2.5)",
  analysis: {
    weights: { spread: 0.05, rsi: 0.20, macd: 0.25, bollinger: 0.15, ma: 0.35 },
    rsi: { overbought: 75, oversold: 25 },
    spread: { threshold_high: 0.0015, threshold_extreme: 0.008 },
    signal: { entry_threshold: 0.55, min_confidence: 0.5, cooldown_seconds: 120 },
  },
  trade: {
    leverage: { default: 3, max: 7 },
    risk: {
      risk_per_trade: 0.015,
      max_position_pct: 0.08,
      max_daily_loss: 0.04,
      max_concurrent_positions: 3,
      max_daily_trades: 30,
      min_signal_confidence: 0.5,
    },
    stopLoss: { atr_multiplier: 2.0 },
    takeProfit: { atr_multiplier: 5.0 },
    trailing_stop: { activation_pct: 1.5, trail_pct: 0.6 },
    progressive_trailing: {
      tiers: [
        { profit_pct: 1.5, trail_pct: 0.6 },
        { profit_pct: 3.0, trail_pct: 0.4 },
        { profit_pct: 5.0, trail_pct: 0.25 },
        { profit_pct: 8.0, trail_pct: 0.15 },
      ],
    },
    smart_tp: { min_profit_pct: 1.0, check_interval_sec: 60 },
    signal_max_age_seconds: 120,
  },
};

// ─── Balanced (균형) ───
// 멀티타임프레임 합류 기반, R:R 2.0, 1h ATR로 SL/TP

const balanced: StrategyPreset = {
  name: "balanced",
  label: "Balanced",
  description: "멀티타임프레임 합류, 안정적 승률 추구 (R:R 2.0)",
  analysis: {
    weights: { spread: 0.10, rsi: 0.20, macd: 0.25, bollinger: 0.15, ma: 0.30 },
    rsi: { overbought: 70, oversold: 30 },
    spread: { threshold_high: 0.001, threshold_extreme: 0.005 },
    signal: { entry_threshold: 0.45, min_confidence: 0.4, cooldown_seconds: 60 },
  },
  trade: {
    leverage: { default: 5, max: 10 },
    risk: {
      risk_per_trade: 0.02,
      max_position_pct: 0.12,
      max_daily_loss: 0.06,
      max_concurrent_positions: 4,
      max_daily_trades: 80,
      min_signal_confidence: 0.4,
    },
    stopLoss: { atr_multiplier: 1.5 },
    takeProfit: { atr_multiplier: 3.0 },
    trailing_stop: { activation_pct: 1.0, trail_pct: 0.5 },
    progressive_trailing: {
      tiers: [
        { profit_pct: 1.0, trail_pct: 0.5 },
        { profit_pct: 2.0, trail_pct: 0.35 },
        { profit_pct: 4.0, trail_pct: 0.2 },
        { profit_pct: 7.0, trail_pct: 0.12 },
      ],
    },
    smart_tp: { min_profit_pct: 0.8, check_interval_sec: 60 },
    signal_max_age_seconds: 60,
  },
};

// ─── Aggressive (공격적 모멘텀) ───
// 15m 크로스 기반 빠른 진입, R:R 2.0, 좁은 SL

const aggressive: StrategyPreset = {
  name: "aggressive",
  label: "Aggressive",
  description: "15m 모멘텀 추종, 빠른 진입/탈출 (R:R 2.0)",
  analysis: {
    weights: { spread: 0.10, rsi: 0.15, macd: 0.30, bollinger: 0.10, ma: 0.35 },
    rsi: { overbought: 65, oversold: 35 },
    spread: { threshold_high: 0.0005, threshold_extreme: 0.003 },
    signal: { entry_threshold: 0.30, min_confidence: 0.25, cooldown_seconds: 30 },
  },
  trade: {
    leverage: { default: 7, max: 15 },
    risk: {
      risk_per_trade: 0.03,
      max_position_pct: 0.18,
      max_daily_loss: 0.10,
      max_concurrent_positions: 6,
      max_daily_trades: 150,
      min_signal_confidence: 0.25,
    },
    stopLoss: { atr_multiplier: 1.0 },
    takeProfit: { atr_multiplier: 2.0 },
    trailing_stop: { activation_pct: 0.7, trail_pct: 0.3 },
    progressive_trailing: {
      tiers: [
        { profit_pct: 0.7, trail_pct: 0.3 },
        { profit_pct: 1.5, trail_pct: 0.2 },
        { profit_pct: 3.0, trail_pct: 0.12 },
        { profit_pct: 5.0, trail_pct: 0.08 },
      ],
    },
    smart_tp: { min_profit_pct: 0.5, check_interval_sec: 45 },
    signal_max_age_seconds: 45,
  },
};

// ─── Registry ───

const PRESETS: Record<StrategyName, StrategyPreset> = {
  conservative,
  balanced,
  aggressive,
};

export function getStrategyPreset(name: string): StrategyPreset {
  const preset = PRESETS[name as StrategyName];
  if (!preset) {
    console.warn(`[Strategy] Unknown strategy "${name}", falling back to "balanced"`);
    return balanced;
  }
  return preset;
}

export function getAllStrategies(): StrategyPreset[] {
  return Object.values(PRESETS);
}

export function isValidStrategy(name: string): name is StrategyName {
  return name in PRESETS;
}
