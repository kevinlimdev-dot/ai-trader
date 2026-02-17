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

const conservative: StrategyPreset = {
  name: "conservative",
  label: "Conservative",
  description: "높은 진입 장벽, 낮은 거래 빈도, 자본 보존 우선",
  analysis: {
    weights: { spread: 0.30, rsi: 0.15, macd: 0.20, bollinger: 0.15, ma: 0.20 },
    rsi: { overbought: 70, oversold: 30 },
    signal: { entry_threshold: 0.5, min_confidence: 0.4, cooldown_seconds: 60 },
  },
  trade: {
    leverage: { default: 5, max: 10 },
    risk: {
      risk_per_trade: 0.02,
      max_position_pct: 0.10,
      max_daily_loss: 0.05,
      max_concurrent_positions: 5,
      max_daily_trades: 100,
      min_signal_confidence: 0.4,
    },
    stopLoss: { atr_multiplier: 2.0 },
    takeProfit: { atr_multiplier: 3.0 },
    trailing_stop: { activation_pct: 1.5, trail_pct: 0.8 },
    signal_max_age_seconds: 60,
  },
};

// ─── Balanced (균형) ───

const balanced: StrategyPreset = {
  name: "balanced",
  label: "Balanced",
  description: "선별적 진입, 넓은 SL, 안정적 승률 추구",
  analysis: {
    weights: { spread: 0.25, rsi: 0.15, macd: 0.25, bollinger: 0.10, ma: 0.25 },
    rsi: { overbought: 65, oversold: 35 },
    signal: { entry_threshold: 0.4, min_confidence: 0.35, cooldown_seconds: 30 },
  },
  trade: {
    leverage: { default: 7, max: 15 },
    risk: {
      risk_per_trade: 0.03,
      max_position_pct: 0.15,
      max_daily_loss: 0.08,
      max_concurrent_positions: 6,
      max_daily_trades: 150,
      min_signal_confidence: 0.35,
    },
    stopLoss: { atr_multiplier: 2.0 },
    takeProfit: { atr_multiplier: 2.5 },
    trailing_stop: { activation_pct: 2.0, trail_pct: 1.0 },
    signal_max_age_seconds: 45,
  },
};

// ─── Aggressive (공격적 모멘텀) ───

const aggressive: StrategyPreset = {
  name: "aggressive",
  label: "Aggressive",
  description: "고빈도 모멘텀 추종, 높은 레버리지, 고수익-고위험",
  analysis: {
    weights: { spread: 0.15, rsi: 0.15, macd: 0.30, bollinger: 0.10, ma: 0.30 },
    rsi: { overbought: 60, oversold: 40 },
    signal: { entry_threshold: 0.15, min_confidence: 0.1, cooldown_seconds: 10 },
  },
  trade: {
    leverage: { default: 10, max: 20 },
    risk: {
      risk_per_trade: 0.05,
      max_position_pct: 0.25,
      max_daily_loss: 0.15,
      max_concurrent_positions: 15,
      max_daily_trades: 500,
      min_signal_confidence: 0.1,
    },
    stopLoss: { atr_multiplier: 1.0 },
    takeProfit: { atr_multiplier: 4.0 },
    trailing_stop: { activation_pct: 0.7, trail_pct: 0.3 },
    signal_max_age_seconds: 30,
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
