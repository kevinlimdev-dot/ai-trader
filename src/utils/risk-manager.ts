import { loadConfig } from "./config";
import { getOpenTrades, getTodayTradeCount, getTodayPnl } from "../db/repository";
import { createLogger } from "./logger";
import { existsSync } from "fs";
import { resolve } from "path";
import { getProjectRoot } from "./config";

const logger = createLogger("RiskManager");

export interface PositionSizeParams {
  balance: number;
  entryPrice: number;
  stopLoss: number;
  leverage: number;
}

export interface RiskCheckResult {
  allowed: boolean;
  reason?: string;
}

export class RiskManager {
  private config = loadConfig();

  // ─── Kill Switch ───

  isKillSwitchActive(): boolean {
    const root = getProjectRoot();
    const killFile = resolve(root, this.config.trade_agent.safety.kill_switch_file);
    return existsSync(killFile);
  }

  createKillSwitch(reason: string): void {
    const root = getProjectRoot();
    const killFile = resolve(root, this.config.trade_agent.safety.kill_switch_file);
    Bun.write(killFile, JSON.stringify({ reason, timestamp: new Date().toISOString() }));
    logger.error("KILL SWITCH 활성화", { reason });
  }

  // ─── Pre-Trade Checks ───

  checkCanTrade(): RiskCheckResult {
    // Kill Switch 확인
    if (this.isKillSwitchActive()) {
      return { allowed: false, reason: "KILL_SWITCH 활성화됨" };
    }

    // 일일 거래 횟수
    const todayCount = getTodayTradeCount();
    if (todayCount >= this.config.trade_agent.risk.max_daily_trades) {
      return { allowed: false, reason: `일일 최대 거래 횟수 초과 (${todayCount}/${this.config.trade_agent.risk.max_daily_trades})` };
    }

    // 동시 포지션 수
    const openTrades = getOpenTrades();
    if (openTrades.length >= this.config.trade_agent.risk.max_concurrent_positions) {
      return { allowed: false, reason: `최대 동시 포지션 초과 (${openTrades.length}/${this.config.trade_agent.risk.max_concurrent_positions})` };
    }

    return { allowed: true };
  }

  checkDailyLoss(currentBalance: number, startBalance: number): RiskCheckResult {
    const todayPnl = getTodayPnl();
    const lossPct = Math.abs(todayPnl) / startBalance;

    if (todayPnl < 0 && lossPct >= this.config.trade_agent.risk.max_daily_loss) {
      return {
        allowed: false,
        reason: `일일 최대 손실 초과 (${(lossPct * 100).toFixed(2)}% / ${this.config.trade_agent.risk.max_daily_loss * 100}%)`,
      };
    }

    return { allowed: true };
  }

  checkMinBalance(balance: number): RiskCheckResult {
    if (balance < this.config.trade_agent.risk.min_balance_usdc) {
      return {
        allowed: false,
        reason: `최소 잔고 미달 (${balance} / ${this.config.trade_agent.risk.min_balance_usdc} USDC)`,
      };
    }
    return { allowed: true };
  }

  checkSignalConfidence(confidence: number): RiskCheckResult {
    if (confidence < this.config.trade_agent.risk.min_signal_confidence) {
      return {
        allowed: false,
        reason: `시그널 신뢰도 부족 (${confidence} < ${this.config.trade_agent.risk.min_signal_confidence})`,
      };
    }
    return { allowed: true };
  }

  // ─── Position Sizing ───

  calculatePositionSize(params: PositionSizeParams): number {
    const { balance, entryPrice, stopLoss, leverage } = params;
    const riskPerTrade = this.config.trade_agent.risk.risk_per_trade;
    const maxPositionPct = this.config.trade_agent.risk.max_position_pct;

    // 리스크 기반 계산
    const riskAmount = balance * riskPerTrade;
    const stopDistance = Math.abs(entryPrice - stopLoss) / entryPrice;

    if (stopDistance === 0) return 0;

    const positionSize = riskAmount / stopDistance / entryPrice;

    // 최대 포지션 제한
    const maxSize = (balance * maxPositionPct * leverage) / entryPrice;

    return Math.min(positionSize, maxSize);
  }

  getLeverage(): number {
    return this.config.trade_agent.leverage.default;
  }

  getMaxLeverage(): number {
    return this.config.trade_agent.leverage.max;
  }

  // ─── Trailing Stop ───

  shouldActivateTrailingStop(pnlPct: number): boolean {
    if (!this.config.trade_agent.trailing_stop.enabled) return false;
    return pnlPct >= this.config.trade_agent.trailing_stop.activation_pct;
  }

  shouldTriggerTrailingStop(currentPnlPct: number, peakPnlPct: number): boolean {
    if (!this.config.trade_agent.trailing_stop.enabled) return false;
    const drawdown = peakPnlPct - currentPnlPct;
    return drawdown >= this.config.trade_agent.trailing_stop.trail_pct;
  }

  // ─── Price Anomaly ───

  isPriceAnomaly(oldPrice: number, newPrice: number): boolean {
    if (oldPrice === 0) return false;
    const changePct = Math.abs((newPrice - oldPrice) / oldPrice) * 100;
    return changePct >= this.config.trade_agent.safety.price_anomaly_threshold;
  }

  // ─── Full Validation ───

  validateTrade(params: {
    balance: number;
    startBalance: number;
    confidence: number;
  }): RiskCheckResult {
    const checks = [
      this.checkCanTrade(),
      this.checkMinBalance(params.balance),
      this.checkDailyLoss(params.balance, params.startBalance),
      this.checkSignalConfidence(params.confidence),
    ];

    for (const check of checks) {
      if (!check.allowed) return check;
    }

    return { allowed: true };
  }
}
