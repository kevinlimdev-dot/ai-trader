export type OrderSide = "LONG" | "SHORT";
export type OrderStatus = "open" | "closed" | "cancelled" | "paper";
export type ExitReason =
  | "take_profit"
  | "stop_loss"
  | "trailing_stop"
  | "manual"
  | "manual_close"
  | "signal_reverse"
  | "emergency"
  | "kill_switch"
  | "daily_loss_limit"
  | "external_close";

export interface TradeRecord {
  id?: number;
  trade_id: string;
  timestamp_open: string;
  timestamp_close?: string;
  symbol: string;
  side: OrderSide;
  entry_price: number;
  exit_price?: number;
  size: number;
  leverage: number;
  stop_loss?: number;
  take_profit?: number;
  peak_pnl_pct?: number;
  trailing_activated?: number;
  pnl?: number;
  pnl_pct?: number;
  fees?: number;
  exit_reason?: ExitReason;
  signal_confidence: number;
  status: OrderStatus;
  created_at?: string;
}

export interface WalletTransfer {
  id?: number;
  transfer_id: string;
  timestamp: string;
  direction: "coinbase_to_hl" | "hl_to_coinbase";
  amount: number;
  currency: string;
  status: "pending" | "completed" | "failed";
  tx_hash?: string;
  created_at?: string;
}

export interface BalanceSnapshot {
  id?: number;
  timestamp: string;
  coinbase_balance: number;
  hyperliquid_balance: number;
  total_balance: number;
  created_at?: string;
}

export interface DailySummary {
  date: string;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  total_pnl: number;
  total_pnl_pct: number;
  max_win: number;
  max_loss: number;
  avg_pnl: number;
  total_fees: number;
  balance_start: number;
  balance_end: number;
}

/**
 * 자금 요청 (trader → wallet-manager 간 데이터 플로우)
 */
export interface FundRequest {
  request_id: string;
  timestamp: string;
  type: "fund" | "withdraw";
  amount: number;
  reason: string;
  priority: "low" | "normal" | "high" | "urgent";
  status: "pending" | "processing" | "completed" | "rejected";
}
