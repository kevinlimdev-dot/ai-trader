export interface BinanceData {
  mark_price: number;
  bid: number;
  ask: number;
  volume_24h: number;
  funding_rate: number;
}

export interface HyperliquidData {
  mid_price: number;
  bid: number;
  ask: number;
}

export interface SpreadData {
  absolute: number;
  percentage: number;
  direction: "binance_higher" | "binance_lower";
}

export interface CandleData {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MultiTimeframeCandles {
  "1m"?: CandleData[];
  "15m"?: CandleData[];
  "1h"?: CandleData[];
  "4h"?: CandleData[];
}

export interface PriceSnapshot {
  timestamp: string;
  symbol: string;
  binance: BinanceData;
  hyperliquid: HyperliquidData;
  spread: SpreadData;
  candles_1m?: CandleData[];
  candles?: MultiTimeframeCandles;
  anomaly?: boolean;
}

export interface SnapshotCollection {
  collected_at: string;
  snapshots: PriceSnapshot[];
}
