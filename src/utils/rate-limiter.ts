/**
 * Token Bucket Rate Limiter
 *
 * 거래소 API 쿼터를 안전하게 관리한다.
 *
 * 바이낸스 선물 공개 API 제한:
 *   - IP당 2,400 req/min (40 req/s)
 *   - weight 기반: 대부분 엔드포인트 weight 1, klines = 5, depth = 5~50
 *
 * 하이퍼리퀴드:
 *   - 공식 rate limit: 1,200 req/min (20 req/s)
 *
 * 안전 마진 70%로 운용:
 *   - Binance: 28 req/s (1,680/min)
 *   - HyperLiquid: 14 req/s (840/min)
 */

import { createLogger } from "./logger";

const logger = createLogger("RateLimiter");

interface RateLimiterConfig {
  maxTokens: number;     // 버킷 최대 토큰 수
  refillRate: number;    // 초당 리필 토큰 수
  name: string;
}

export class RateLimiter {
  private tokens: number;
  private maxTokens: number;
  private refillRate: number;
  private lastRefill: number;
  private name: string;
  private totalRequests = 0;
  private totalWaits = 0;

  constructor(config: RateLimiterConfig) {
    this.maxTokens = config.maxTokens;
    this.tokens = config.maxTokens;
    this.refillRate = config.refillRate;
    this.lastRefill = Date.now();
    this.name = config.name;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  /**
   * 토큰을 소비한다. 토큰이 부족하면 대기한다.
   * @param weight 소비할 토큰 수 (기본 1)
   */
  async acquire(weight: number = 1): Promise<void> {
    this.refill();
    this.totalRequests++;

    if (this.tokens >= weight) {
      this.tokens -= weight;
      return;
    }

    // 토큰 부족 → 대기
    const deficit = weight - this.tokens;
    const waitMs = Math.ceil((deficit / this.refillRate) * 1000);
    this.totalWaits++;

    logger.warn(`${this.name} rate limit 대기`, {
      wait_ms: waitMs,
      tokens_available: this.tokens.toFixed(2),
      needed: weight,
      total_waits: this.totalWaits,
    });

    await new Promise((r) => setTimeout(r, waitMs));
    this.refill();
    this.tokens -= weight;
  }

  /**
   * 현재 상태 반환
   */
  getStats(): { name: string; tokens: number; maxTokens: number; totalRequests: number; totalWaits: number } {
    this.refill();
    return {
      name: this.name,
      tokens: Math.floor(this.tokens),
      maxTokens: this.maxTokens,
      totalRequests: this.totalRequests,
      totalWaits: this.totalWaits,
    };
  }
}

// ─── 싱글턴 인스턴스 ───

let binanceLimiter: RateLimiter | null = null;
let hyperliquidLimiter: RateLimiter | null = null;

export function getBinanceRateLimiter(): RateLimiter {
  if (!binanceLimiter) {
    binanceLimiter = new RateLimiter({
      name: "Binance",
      maxTokens: 60,        // 버스트 허용량
      refillRate: 28,        // 초당 28 요청 (70% of 40)
    });
  }
  return binanceLimiter;
}

export function getHyperliquidRateLimiter(): RateLimiter {
  if (!hyperliquidLimiter) {
    hyperliquidLimiter = new RateLimiter({
      name: "HyperLiquid",
      maxTokens: 30,         // 버스트 허용량
      refillRate: 14,        // 초당 14 요청 (70% of 20)
    });
  }
  return hyperliquidLimiter;
}

/**
 * API weight 매핑 (바이낸스 기준)
 */
export const BINANCE_WEIGHTS: Record<string, number> = {
  "/fapi/v1/premiumIndex": 1,
  "/fapi/v1/depth": 5,
  "/fapi/v1/ticker/24hr": 1,
  "/fapi/v1/klines": 5,
};

export const HYPERLIQUID_WEIGHTS: Record<string, number> = {
  allMids: 1,
  l2Book: 1,
  meta: 1,
  clearinghouseState: 1,
  order: 2,
};
