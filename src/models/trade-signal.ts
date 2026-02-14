export type SignalAction = "LONG" | "SHORT" | "HOLD";

export type IndicatorSignal =
  | "STRONG_LONG"
  | "LONG"
  | "LONG_BIAS"
  | "NEUTRAL"
  | "SHORT_BIAS"
  | "SHORT"
  | "STRONG_SHORT";

export interface SpreadAnalysis {
  value_pct: number;
  direction: string;
  signal: IndicatorSignal;
}

export interface RsiAnalysis {
  value: number;
  signal: IndicatorSignal;
}

export interface MacdAnalysis {
  histogram: number;
  macd_line: number;
  signal_line: number;
  signal: IndicatorSignal;
}

export interface BollingerAnalysis {
  upper: number;
  middle: number;
  lower: number;
  position: "above" | "upper" | "middle" | "lower" | "below";
  signal: IndicatorSignal;
}

export interface MaAnalysis {
  ma_7: number;
  ma_25: number;
  ma_99: number;
  signal: IndicatorSignal;
}

export interface AnalysisDetail {
  spread: SpreadAnalysis;
  rsi: RsiAnalysis;
  macd: MacdAnalysis;
  bollinger: BollingerAnalysis;
  ma: MaAnalysis;
  composite_score: number;
}

export interface RiskDetail {
  risk_reward_ratio: number;
  max_position_pct: number;
  atr: number;
}

export interface TradeSignal {
  timestamp: string;
  symbol: string;
  action: SignalAction;
  confidence: number;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  analysis: AnalysisDetail;
  risk: RiskDetail;
}

export interface SignalCollection {
  generated_at: string;
  signals: TradeSignal[];
}
