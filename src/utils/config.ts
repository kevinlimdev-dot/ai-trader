import { readFileSync, existsSync } from "fs";
import { parse } from "yaml";
import { resolve } from "path";
import { setGlobalLogLevel } from "./logger";

export interface SymbolConfig {
  symbol: string;
  binance_pair: string;
  hyperliquid_pair: string;
}

export interface AppConfig {
  general: {
    mode: "paper" | "live";
    log_level: "debug" | "info" | "warn" | "error";
    timezone: string;
  };
  data_agent: {
    symbols: SymbolConfig[];
    polling_interval_ms: number;
    candle_interval: string;
    candle_lookback: number;
    binance: {
      base_url: string;
      reconnect_delay_ms: number;
      max_reconnect_attempts: number;
    };
    hyperliquid: {
      base_url: string;
      request_timeout_ms: number;
    };
    anomaly_threshold_pct: number;
    storage: {
      max_snapshots_per_symbol: number;
      cleanup_interval_min: number;
    };
  };
  analysis_agent: {
    spread: {
      threshold_high: number;
      threshold_extreme: number;
      lookback_count: number;
    };
    indicators: {
      rsi: { period: number; overbought: number; oversold: number };
      macd: { fast: number; slow: number; signal: number };
      bollinger: { period: number; std_dev: number };
      ma: { short: number; medium: number; long: number };
    };
    weights: {
      spread: number;
      rsi: number;
      macd: number;
      bollinger: number;
      ma: number;
    };
    signal: {
      entry_threshold: number;
      min_confidence: number;
      cooldown_seconds: number;
    };
    risk: {
      atr_period: number;
      stop_loss_multiplier: number;
      take_profit_multiplier: number;
      min_risk_reward_ratio: number;
    };
  };
  trade_agent: {
    hyperliquid: {
      base_url: string;
      slippage: number;
    };
    leverage: { default: number; max: number };
    risk: {
      risk_per_trade: number;
      max_position_pct: number;
      max_daily_loss: number;
      max_concurrent_positions: number;
      max_daily_trades: number;
      min_balance_usdc: number;
      min_signal_confidence: number;
    };
    trailing_stop: {
      enabled: boolean;
      activation_pct: number;
      trail_pct: number;
    };
    safety: {
      kill_switch_file: string;
      max_consecutive_api_errors: number;
      price_anomaly_threshold: number;
    };
    paper_fee_rate: number;
    signal_max_age_seconds: number;
  };
  wallet_agent: {
    monitoring: {
      balance_check_interval_sec: number;
      low_balance_alert_usdc: number;
    };
    agentic_wallet: {
      network: string;
      cli_timeout_ms: number;
    };
    transfers: {
      max_single_transfer: number;
      max_daily_transfer: number;
      auto_fund_enabled: boolean;
      auto_fund_buffer_pct: number;
      auto_withdraw_excess_pct?: number;
    };
    security: {
      min_reserve_coinbase: number;
      min_reserve_hyperliquid: number;
      max_reserve_hyperliquid?: number;
      whitelist: string[];
    };
  };
  database: {
    path: string;
    wal_mode: boolean;
  };
}

let cachedConfig: AppConfig | null = null;

export function getProjectRoot(): string {
  // 프로젝트 루트 결정: config.yaml이 있는 디렉토리 찾기
  let dir = process.cwd();
  while (dir !== "/") {
    if (existsSync(resolve(dir, "config.yaml"))) return dir;
    dir = resolve(dir, "..");
  }
  return process.cwd();
}

export function loadConfig(configPath?: string): AppConfig {
  if (cachedConfig && !configPath) return cachedConfig;

  const root = getProjectRoot();
  const filePath = configPath || resolve(root, "config.yaml");

  if (!existsSync(filePath)) {
    throw new Error(`설정 파일을 찾을 수 없습니다: ${filePath}`);
  }

  const raw = readFileSync(filePath, "utf-8");
  const config = parse(raw) as AppConfig;
  cachedConfig = config;

  // 로거 레벨 초기화
  if (config.general?.log_level) {
    setGlobalLogLevel(config.general.log_level);
  }

  return config;
}

export function isPaperMode(): boolean {
  return loadConfig().general.mode === "paper";
}

export function getDbPath(): string {
  const config = loadConfig();
  const root = getProjectRoot();
  return resolve(root, config.database.path);
}

export function getDataDir(): string {
  return resolve(getProjectRoot(), "data");
}
