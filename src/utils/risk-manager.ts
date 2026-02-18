import { loadConfig } from "./config";
import { getOpenTrades, getTodayTradeCount, getTodayPnl } from "../db/repository";
import { createLogger } from "./logger";
import { existsSync } from "fs";
import { resolve } from "path";
import { getProjectRoot } from "./config";
import type { TradeOverrides } from "../strategies/presets";

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
  private overrides: TradeOverrides | null = null;

  constructor(overrides?: TradeOverrides) {
    if (overrides) this.overrides = overrides;
    this.validateConfig();
  }

  applyOverrides(overrides: TradeOverrides): void {
    this.overrides = overrides;
    logger.info("전략 오버라이드 적용", {
      leverage: overrides.leverage.default,
      risk: overrides.risk.risk_per_trade,
      max_positions: overrides.risk.max_concurrent_positions,
    });
  }

  // ─── Config Validation ───

  private validateConfig(): void {
    const risk = this.config.trade_agent.risk;
    const ts = this.config.trade_agent.trailing_stop;

    if (risk.risk_per_trade <= 0 || risk.risk_per_trade > 1) {
      logger.warn("risk_per_trade 값이 비정상적입니다", { value: risk.risk_per_trade });
    }
    if (risk.max_position_pct <= 0 || risk.max_position_pct > 1) {
      logger.warn("max_position_pct 값이 비정상적입니다", { value: risk.max_position_pct });
    }
    if (risk.max_daily_loss <= 0 || risk.max_daily_loss > 1) {
      logger.warn("max_daily_loss 값이 비정상적입니다", { value: risk.max_daily_loss });
    }
    if (ts.enabled && (ts.activation_pct <= 0 || ts.trail_pct <= 0)) {
      logger.warn("트레일링 스탑 설정이 비정상적입니다", { activation: ts.activation_pct, trail: ts.trail_pct });
    }

    // 가중치 합 검증 (분석 에이전트)
    const weights = this.config.analysis_agent.weights;
    const sum = Object.values(weights).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1.0) > 0.01) {
      logger.warn("분석 가중치 합이 1.0이 아닙니다", { sum: sum.toFixed(2) });
    }
  }

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
    if (this.isKillSwitchActive()) {
      return { allowed: false, reason: "KILL_SWITCH 활성화됨" };
    }

    const maxDailyTrades = this.overrides?.risk.max_daily_trades ?? this.config.trade_agent.risk.max_daily_trades;
    const todayCount = getTodayTradeCount();
    if (todayCount >= maxDailyTrades) {
      return { allowed: false, reason: `일일 최대 거래 횟수 초과 (${todayCount}/${maxDailyTrades})` };
    }

    const maxConcurrent = this.overrides?.risk.max_concurrent_positions ?? this.config.trade_agent.risk.max_concurrent_positions;
    const openTrades = getOpenTrades();
    if (openTrades.length >= maxConcurrent) {
      return { allowed: false, reason: `최대 동시 포지션 초과 (${openTrades.length}/${maxConcurrent})` };
    }

    return { allowed: true };
  }

  checkDailyLoss(currentBalance: number, startBalance: number): RiskCheckResult {
    if (startBalance <= 0) {
      logger.warn("시작 잔고가 0 이하", { startBalance });
      return { allowed: true };
    }

    const maxDailyLoss = this.overrides?.risk.max_daily_loss ?? this.config.trade_agent.risk.max_daily_loss;
    const todayPnl = getTodayPnl();
    const lossPct = Math.abs(todayPnl) / startBalance;

    if (todayPnl < 0 && lossPct >= maxDailyLoss) {
      return {
        allowed: false,
        reason: `일일 최대 손실 초과 (${(lossPct * 100).toFixed(2)}% / ${maxDailyLoss * 100}%)`,
      };
    }

    return { allowed: true };
  }

  checkMinBalance(balance: number): RiskCheckResult {
    if (balance < this.config.trade_agent.risk.min_balance_usdc) {
      return {
        allowed: false,
        reason: `최소 잔고 미달 (${balance.toFixed(2)} / ${this.config.trade_agent.risk.min_balance_usdc} USDC)`,
      };
    }
    return { allowed: true };
  }

  checkSignalConfidence(confidence: number): RiskCheckResult {
    const minConfidence = this.overrides?.risk.min_signal_confidence ?? this.config.trade_agent.risk.min_signal_confidence;
    if (confidence < minConfidence) {
      return {
        allowed: false,
        reason: `시그널 신뢰도 부족 (${confidence.toFixed(2)} < ${minConfidence})`,
      };
    }
    return { allowed: true };
  }

  // ─── Position Sizing ───

  calculatePositionSize(params: PositionSizeParams): number {
    const { balance, entryPrice, stopLoss, leverage } = params;
    const riskPerTrade = this.overrides?.risk.risk_per_trade ?? this.config.trade_agent.risk.risk_per_trade;
    const maxPositionPct = this.overrides?.risk.max_position_pct ?? this.config.trade_agent.risk.max_position_pct;

    // 입력 검증
    if (balance <= 0 || entryPrice <= 0 || leverage <= 0) {
      logger.warn("포지션 크기 계산 불가: 입력값이 0 이하", { balance, entryPrice, leverage });
      return 0;
    }

    // 리스크 기반 계산
    const riskAmount = balance * riskPerTrade;
    const stopDistance = Math.abs(entryPrice - stopLoss) / entryPrice;

    if (stopDistance === 0) {
      logger.warn("스탑 거리가 0", { entryPrice, stopLoss });
      return 0;
    }

    const positionSize = riskAmount / stopDistance / entryPrice;

    // 최대 포지션 제한
    const maxSize = (balance * maxPositionPct * leverage) / entryPrice;

    const finalSize = Math.min(positionSize, maxSize);

    // 최소 크기 체크 (너무 작으면 0 반환)
    if (finalSize * entryPrice < 1) {
      logger.debug("포지션 크기가 $1 미만", { size: finalSize, value: finalSize * entryPrice });
      return 0;
    }

    return finalSize;
  }

  getLeverage(): number {
    return this.overrides?.leverage.default ?? this.config.trade_agent.leverage.default;
  }

  getMaxLeverage(): number {
    return this.overrides?.leverage.max ?? this.config.trade_agent.leverage.max;
  }

  // ─── Trailing Stop ───

  shouldActivateTrailingStop(pnlPct: number): boolean {
    if (!this.config.trade_agent.trailing_stop.enabled) return false;
    const activationPct = this.overrides?.trailing_stop.activation_pct ?? this.config.trade_agent.trailing_stop.activation_pct;
    return pnlPct >= activationPct;
  }

  shouldTriggerTrailingStop(currentPnlPct: number, peakPnlPct: number): boolean {
    if (!this.config.trade_agent.trailing_stop.enabled) return false;
    if (peakPnlPct <= 0) return false;
    const trailPct = this.overrides?.trailing_stop.trail_pct ?? this.config.trade_agent.trailing_stop.trail_pct;
    const drawdown = peakPnlPct - currentPnlPct;
    return drawdown >= trailPct;
  }

  getProgressiveTrailPct(peakPnlPct: number): number {
    const tiers = this.overrides?.progressive_trailing?.tiers;
    if (!tiers || tiers.length === 0) {
      return this.overrides?.trailing_stop.trail_pct ?? this.config.trade_agent.trailing_stop.trail_pct;
    }
    let trailPct = tiers[0].trail_pct;
    for (const tier of tiers) {
      if (peakPnlPct >= tier.profit_pct) {
        trailPct = tier.trail_pct;
      }
    }
    return trailPct;
  }

  shouldTriggerProgressiveTrailing(currentPnlPct: number, peakPnlPct: number): boolean {
    if (!this.config.trade_agent.trailing_stop.enabled) return false;
    if (peakPnlPct <= 0) return false;
    const activationPct = this.overrides?.trailing_stop.activation_pct ?? this.config.trade_agent.trailing_stop.activation_pct;
    if (peakPnlPct < activationPct) return false;
    const trailPct = this.getProgressiveTrailPct(peakPnlPct);
    const drawdown = peakPnlPct - currentPnlPct;
    return drawdown >= trailPct;
  }

  // ─── Price Anomaly ───

  isPriceAnomaly(oldPrice: number, newPrice: number): boolean {
    if (oldPrice <= 0) return false;
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
