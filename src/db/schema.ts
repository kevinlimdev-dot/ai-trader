import { Database } from "bun:sqlite";
import { getDbPath, loadConfig } from "../utils/config";
import { createLogger } from "../utils/logger";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";

const logger = createLogger("DB:Schema");

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  symbol TEXT NOT NULL,
  binance_mark_price REAL NOT NULL,
  binance_bid REAL NOT NULL,
  binance_ask REAL NOT NULL,
  binance_volume_24h REAL,
  binance_funding_rate REAL,
  hl_mid_price REAL NOT NULL,
  hl_bid REAL NOT NULL,
  hl_ask REAL NOT NULL,
  spread_absolute REAL NOT NULL,
  spread_percentage REAL NOT NULL,
  spread_direction TEXT NOT NULL,
  anomaly INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_snapshots_symbol_ts ON snapshots(symbol, timestamp);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_id TEXT UNIQUE NOT NULL,
  timestamp_open TEXT NOT NULL,
  timestamp_close TEXT,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  entry_price REAL NOT NULL,
  exit_price REAL,
  size REAL NOT NULL,
  leverage INTEGER NOT NULL,
  pnl REAL,
  pnl_pct REAL,
  fees REAL,
  exit_reason TEXT,
  signal_confidence REAL,
  status TEXT DEFAULT 'open',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_open_ts ON trades(timestamp_open);

CREATE TABLE IF NOT EXISTS wallet_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_id TEXT UNIQUE NOT NULL,
  timestamp TEXT NOT NULL,
  direction TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USDC',
  status TEXT DEFAULT 'pending',
  tx_hash TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS balance_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  coinbase_balance REAL NOT NULL,
  hyperliquid_balance REAL NOT NULL,
  total_balance REAL NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_balance_ts ON balance_snapshots(timestamp);
`;

export function initDatabase(dbPath?: string): Database {
  const path = dbPath || getDbPath();
  const dir = dirname(path);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new Database(path);

  // WAL 모드 활성화
  const config = loadConfig();
  if (config.database.wal_mode) {
    db.run("PRAGMA journal_mode=WAL");
  }
  db.run("PRAGMA foreign_keys=ON");

  // 스키마 실행
  db.run("BEGIN");
  try {
    for (const stmt of SCHEMA_SQL.split(";").filter((s) => s.trim())) {
      db.run(stmt);
    }
    db.run("COMMIT");
  } catch (err) {
    db.run("ROLLBACK");
    throw err;
  }

  logger.info("데이터베이스 초기화 완료", { path });
  return db;
}

// CLI로 직접 실행 시 DB 초기화
if (import.meta.main) {
  const db = initDatabase();
  logger.info("스키마 생성 완료");
  db.close();
}
