import { Database } from "bun:sqlite";
import type { PriceSnapshot } from "../models/price-snapshot";
import type { TradeRecord, WalletTransfer, BalanceSnapshot, DailySummary } from "../models/order";
import { initDatabase } from "./schema";
import { createLogger } from "../utils/logger";

const logger = createLogger("DB:Repository");

let _db: Database | null = null;

export function getDb(): Database {
  if (!_db) {
    _db = initDatabase();
  }
  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// ─── Snapshots ───

export function insertSnapshot(snapshot: PriceSnapshot): void {
  const db = getDb();
  db.run(
    `INSERT INTO snapshots (
      timestamp, symbol,
      binance_mark_price, binance_bid, binance_ask, binance_volume_24h, binance_funding_rate,
      hl_mid_price, hl_bid, hl_ask,
      spread_absolute, spread_percentage, spread_direction, anomaly
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      snapshot.timestamp,
      snapshot.symbol,
      snapshot.binance.mark_price,
      snapshot.binance.bid,
      snapshot.binance.ask,
      snapshot.binance.volume_24h,
      snapshot.binance.funding_rate,
      snapshot.hyperliquid.mid_price,
      snapshot.hyperliquid.bid,
      snapshot.hyperliquid.ask,
      snapshot.spread.absolute,
      snapshot.spread.percentage,
      snapshot.spread.direction,
      snapshot.anomaly ? 1 : 0,
    ],
  );
}

export function getRecentSnapshots(symbol: string, limit: number = 100): PriceSnapshot[] {
  const db = getDb();
  const rows = db
    .query(
      `SELECT * FROM snapshots WHERE symbol = ? ORDER BY timestamp DESC LIMIT ?`,
    )
    .all(symbol, limit) as any[];

  return rows.map((r) => ({
    timestamp: r.timestamp,
    symbol: r.symbol,
    binance: {
      mark_price: r.binance_mark_price,
      bid: r.binance_bid,
      ask: r.binance_ask,
      volume_24h: r.binance_volume_24h,
      funding_rate: r.binance_funding_rate,
    },
    hyperliquid: {
      mid_price: r.hl_mid_price,
      bid: r.hl_bid,
      ask: r.hl_ask,
    },
    spread: {
      absolute: r.spread_absolute,
      percentage: r.spread_percentage,
      direction: r.spread_direction,
    },
    anomaly: r.anomaly === 1,
  }));
}

export function getClosePrices(symbol: string, limit: number = 100): number[] {
  const db = getDb();
  const rows = db
    .query(
      `SELECT binance_mark_price FROM snapshots WHERE symbol = ? ORDER BY timestamp DESC LIMIT ?`,
    )
    .all(symbol, limit) as any[];

  // 시간순으로 역순 → 오래된 것부터
  return rows.reverse().map((r) => r.binance_mark_price);
}

// ─── Trades ───

export function insertTrade(trade: TradeRecord): void {
  const db = getDb();
  db.run(
    `INSERT INTO trades (
      trade_id, timestamp_open, timestamp_close, symbol, side,
      entry_price, exit_price, size, leverage,
      pnl, pnl_pct, fees, exit_reason, signal_confidence, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      trade.trade_id,
      trade.timestamp_open,
      trade.timestamp_close || null,
      trade.symbol,
      trade.side,
      trade.entry_price,
      trade.exit_price || null,
      trade.size,
      trade.leverage,
      trade.pnl || null,
      trade.pnl_pct || null,
      trade.fees || null,
      trade.exit_reason || null,
      trade.signal_confidence,
      trade.status,
    ],
  );
}

export function updateTrade(
  tradeId: string,
  updates: Partial<TradeRecord>,
): void {
  const db = getDb();
  const sets: string[] = [];
  const values: any[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (key === "trade_id" || key === "id") continue;
    sets.push(`${key} = ?`);
    values.push(value);
  }

  if (sets.length === 0) return;
  values.push(tradeId);
  db.run(`UPDATE trades SET ${sets.join(", ")} WHERE trade_id = ?`, values);
}

export function getOpenTrades(): TradeRecord[] {
  const db = getDb();
  return db.query(`SELECT * FROM trades WHERE status = 'open'`).all() as TradeRecord[];
}

export function getTradesByDate(date: string): TradeRecord[] {
  const db = getDb();
  return db
    .query(`SELECT * FROM trades WHERE DATE(timestamp_open) = ?`)
    .all(date) as TradeRecord[];
}

export function getTodayTradeCount(): number {
  const db = getDb();
  const row = db
    .query(
      `SELECT COUNT(*) as cnt FROM trades WHERE DATE(timestamp_open) = DATE('now')`,
    )
    .get() as { cnt: number };
  return row.cnt;
}

export function getTodayPnl(): number {
  const db = getDb();
  const row = db
    .query(
      `SELECT COALESCE(SUM(pnl), 0) as total FROM trades
       WHERE DATE(timestamp_open) = DATE('now') AND status = 'closed'`,
    )
    .get() as { total: number };
  return row.total;
}

export function getDailySummary(date?: string): DailySummary | null {
  const db = getDb();
  const targetDate = date || new Date().toISOString().split("T")[0];

  const trades = db
    .query(`SELECT * FROM trades WHERE DATE(timestamp_open) = ? AND status IN ('closed', 'paper')`)
    .all(targetDate) as TradeRecord[];

  if (trades.length === 0) return null;

  const winners = trades.filter((t) => (t.pnl || 0) > 0);
  const losers = trades.filter((t) => (t.pnl || 0) < 0);
  const totalPnl = trades.reduce((s, t) => s + (t.pnl || 0), 0);
  const totalFees = trades.reduce((s, t) => s + (t.fees || 0), 0);
  const pnls = trades.map((t) => t.pnl || 0);

  return {
    date: targetDate,
    total_trades: trades.length,
    winning_trades: winners.length,
    losing_trades: losers.length,
    win_rate: trades.length > 0 ? winners.length / trades.length : 0,
    total_pnl: totalPnl,
    total_pnl_pct: 0, // 잔고 기준으로 외부에서 계산
    max_win: Math.max(...pnls, 0),
    max_loss: Math.min(...pnls, 0),
    avg_pnl: trades.length > 0 ? totalPnl / trades.length : 0,
    total_fees: totalFees,
    balance_start: 0,
    balance_end: 0,
  };
}

// ─── Wallet Transfers ───

export function insertWalletTransfer(transfer: WalletTransfer): void {
  const db = getDb();
  db.run(
    `INSERT INTO wallet_transfers (transfer_id, timestamp, direction, amount, currency, status, tx_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      transfer.transfer_id,
      transfer.timestamp,
      transfer.direction,
      transfer.amount,
      transfer.currency,
      transfer.status,
      transfer.tx_hash || null,
    ],
  );
}

export function getTodayTransferTotal(): number {
  const db = getDb();
  const row = db
    .query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM wallet_transfers
       WHERE DATE(timestamp) = DATE('now') AND status = 'completed'`,
    )
    .get() as { total: number };
  return row.total;
}

// ─── Balance Snapshots ───

export function insertBalanceSnapshot(snapshot: BalanceSnapshot): void {
  const db = getDb();
  db.run(
    `INSERT INTO balance_snapshots (timestamp, coinbase_balance, hyperliquid_balance, total_balance)
     VALUES (?, ?, ?, ?)`,
    [
      snapshot.timestamp,
      snapshot.coinbase_balance,
      snapshot.hyperliquid_balance,
      snapshot.total_balance,
    ],
  );
}

export function getLatestBalance(): BalanceSnapshot | null {
  const db = getDb();
  return db
    .query(`SELECT * FROM balance_snapshots ORDER BY timestamp DESC LIMIT 1`)
    .get() as BalanceSnapshot | null;
}

// ─── Cleanup ───

export function cleanupOldSnapshots(maxPerSymbol: number): void {
  const db = getDb();
  db.run(
    `DELETE FROM snapshots WHERE id NOT IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY timestamp DESC) as rn
        FROM snapshots
      ) WHERE rn <= ?
    )`,
    [maxPerSymbol],
  );
  logger.debug("오래된 스냅샷 정리 완료", { maxPerSymbol });
}
