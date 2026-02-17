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

// ─── 트랜잭션 헬퍼 ───

export function runTransaction<T>(fn: (db: Database) => T): T {
  const db = getDb();
  db.run("BEGIN");
  try {
    const result = fn(db);
    db.run("COMMIT");
    return result;
  } catch (err) {
    db.run("ROLLBACK");
    throw err;
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
      stop_loss, take_profit, peak_pnl_pct, trailing_activated,
      pnl, pnl_pct, fees, exit_reason, signal_confidence, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      trade.stop_loss || null,
      trade.take_profit || null,
      trade.peak_pnl_pct || 0,
      trade.trailing_activated || 0,
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
    if (key === "trade_id" || key === "id" || key === "created_at") continue;
    sets.push(`${key} = ?`);
    values.push(value);
  }

  if (sets.length === 0) return;
  values.push(tradeId);
  db.run(`UPDATE trades SET ${sets.join(", ")} WHERE trade_id = ?`, values);
}

export function getOpenTrades(): TradeRecord[] {
  const db = getDb();
  return db.query(`SELECT * FROM trades WHERE status IN ('open', 'paper')`).all() as TradeRecord[];
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

  // 잔고 정보 가져오기
  const balanceStart = getLatestBalance();

  return {
    date: targetDate,
    total_trades: trades.length,
    winning_trades: winners.length,
    losing_trades: losers.length,
    win_rate: trades.length > 0 ? winners.length / trades.length : 0,
    total_pnl: totalPnl,
    total_pnl_pct: balanceStart?.total_balance
      ? (totalPnl / balanceStart.total_balance) * 100
      : 0,
    max_win: Math.max(...pnls, 0),
    max_loss: Math.min(...pnls, 0),
    avg_pnl: trades.length > 0 ? totalPnl / trades.length : 0,
    total_fees: totalFees,
    balance_start: balanceStart?.total_balance || 0,
    balance_end: (balanceStart?.total_balance || 0) + totalPnl,
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

// ─── Latest Snapshot Price (for anomaly detection) ───

export function getLatestSnapshotPrice(symbol: string): { binance: number; hl: number } | null {
  const db = getDb();
  const row = db
    .query(
      `SELECT binance_mark_price, hl_mid_price FROM snapshots
       WHERE symbol = ? ORDER BY timestamp DESC LIMIT 1`,
    )
    .get(symbol) as { binance_mark_price: number; hl_mid_price: number } | null;

  if (!row) return null;
  return { binance: row.binance_mark_price, hl: row.hl_mid_price };
}

// ─── Last Signal Time (for cooldown) ───

export function getLastSignalTime(symbol: string): string | null {
  const db = getDb();
  const row = db
    .query(
      `SELECT timestamp_open FROM trades
       WHERE symbol = ? ORDER BY timestamp_open DESC LIMIT 1`,
    )
    .get(symbol) as { timestamp_open: string } | null;

  return row?.timestamp_open || null;
}

// ─── Trade by Symbol (for position monitoring) ───

export function getOpenTradeBySymbol(symbol: string): TradeRecord | null {
  const db = getDb();
  return db
    .query(`SELECT * FROM trades WHERE symbol = ? AND status IN ('open', 'paper') ORDER BY timestamp_open DESC LIMIT 1`)
    .get(symbol) as TradeRecord | null;
}

// ─── 최근 거래 이력 & 성과 통계 (AI 판단용) ───

export function getRecentClosedTrades(limit: number = 50): TradeRecord[] {
  const db = getDb();
  return db
    .query(`SELECT * FROM trades WHERE status = 'closed' ORDER BY timestamp_close DESC LIMIT ?`)
    .all(limit) as TradeRecord[];
}

export function getPerformanceStats(days: number = 7): {
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  total_pnl: number;
  avg_pnl: number;
  avg_win: number;
  avg_loss: number;
  max_win: number;
  max_loss: number;
  avg_hold_time_min: number;
  best_symbols: { symbol: string; pnl: number; count: number }[];
  worst_symbols: { symbol: string; pnl: number; count: number }[];
  pnl_by_side: { long_pnl: number; short_pnl: number; long_count: number; short_count: number };
  consecutive_losses: number;
} {
  const db = getDb();
  const trades = db
    .query(`SELECT * FROM trades WHERE status = 'closed' AND timestamp_close >= datetime('now', '-${days} days')`)
    .all() as TradeRecord[];

  if (trades.length === 0) {
    return {
      total_trades: 0, winning_trades: 0, losing_trades: 0, win_rate: 0,
      total_pnl: 0, avg_pnl: 0, avg_win: 0, avg_loss: 0, max_win: 0, max_loss: 0,
      avg_hold_time_min: 0, best_symbols: [], worst_symbols: [],
      pnl_by_side: { long_pnl: 0, short_pnl: 0, long_count: 0, short_count: 0 },
      consecutive_losses: 0,
    };
  }

  const winners = trades.filter((t) => (t.pnl || 0) > 0);
  const losers = trades.filter((t) => (t.pnl || 0) < 0);
  const pnls = trades.map((t) => t.pnl || 0);
  const totalPnl = pnls.reduce((s, p) => s + p, 0);

  // 평균 보유 시간
  const holdTimes = trades
    .filter((t) => t.timestamp_open && t.timestamp_close)
    .map((t) => (new Date(t.timestamp_close!).getTime() - new Date(t.timestamp_open).getTime()) / 60000);
  const avgHoldTime = holdTimes.length > 0 ? holdTimes.reduce((s, h) => s + h, 0) / holdTimes.length : 0;

  // 심볼별 성과
  const symbolMap = new Map<string, { pnl: number; count: number }>();
  for (const t of trades) {
    const prev = symbolMap.get(t.symbol) || { pnl: 0, count: 0 };
    symbolMap.set(t.symbol, { pnl: prev.pnl + (t.pnl || 0), count: prev.count + 1 });
  }
  const symbolStats = [...symbolMap.entries()].map(([symbol, stats]) => ({ symbol, ...stats }));
  const bestSymbols = symbolStats.sort((a, b) => b.pnl - a.pnl).slice(0, 5);
  const worstSymbols = symbolStats.sort((a, b) => a.pnl - b.pnl).slice(0, 5);

  // 롱/숏별 성과
  const longTrades = trades.filter((t) => t.side === "LONG");
  const shortTrades = trades.filter((t) => t.side === "SHORT");

  // 연속 손실
  let maxConsecLoss = 0;
  let currentConsec = 0;
  for (const t of [...trades].reverse()) {
    if ((t.pnl || 0) < 0) { currentConsec++; maxConsecLoss = Math.max(maxConsecLoss, currentConsec); }
    else { currentConsec = 0; }
  }

  return {
    total_trades: trades.length,
    winning_trades: winners.length,
    losing_trades: losers.length,
    win_rate: trades.length > 0 ? winners.length / trades.length : 0,
    total_pnl: totalPnl,
    avg_pnl: trades.length > 0 ? totalPnl / trades.length : 0,
    avg_win: winners.length > 0 ? winners.reduce((s, t) => s + (t.pnl || 0), 0) / winners.length : 0,
    avg_loss: losers.length > 0 ? losers.reduce((s, t) => s + (t.pnl || 0), 0) / losers.length : 0,
    max_win: Math.max(...pnls, 0),
    max_loss: Math.min(...pnls, 0),
    avg_hold_time_min: avgHoldTime,
    best_symbols: bestSymbols,
    worst_symbols: worstSymbols,
    pnl_by_side: {
      long_pnl: longTrades.reduce((s, t) => s + (t.pnl || 0), 0),
      short_pnl: shortTrades.reduce((s, t) => s + (t.pnl || 0), 0),
      long_count: longTrades.length,
      short_count: shortTrades.length,
    },
    consecutive_losses: maxConsecLoss,
  };
}

// ─── API Error Counter (파일 기반 — 프로세스 재시작에도 유지) ───

const API_ERROR_FILE = "api_error_count";

export function getApiErrorCount(): number {
  const db = getDb();
  const row = db
    .query(`SELECT value FROM api_state WHERE key = ?`)
    .get(API_ERROR_FILE) as { value: string } | null;
  return row ? parseInt(row.value, 10) : 0;
}

export function incrementApiErrorCount(): number {
  const current = getApiErrorCount();
  const next = current + 1;
  const db = getDb();
  db.run(
    `INSERT INTO api_state (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')`,
    [API_ERROR_FILE, String(next), String(next)],
  );
  return next;
}

export function resetApiErrorCount(): void {
  const db = getDb();
  db.run(
    `INSERT INTO api_state (key, value, updated_at) VALUES (?, '0', datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = '0', updated_at = datetime('now')`,
    [API_ERROR_FILE],
  );
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
