import { createLogger } from "../utils/logger";
import { loadConfig } from "../utils/config";
import { getBinanceRateLimiter, BINANCE_WEIGHTS } from "../utils/rate-limiter";
import type { CandleData } from "../models/price-snapshot";

const logger = createLogger("Binance");

// 바이낸스 선물 REST API 직접 호출 (공식 SDK 대신 경량 구현)
// 가격 조회에는 API 키 불필요 (public endpoints)
// Rate limit: IP당 2,400 req/min — 안전 마진 70%로 운용

interface BinanceMarkPriceResponse {
  symbol: string;
  markPrice: string;
  indexPrice: string;
  lastFundingRate: string;
  nextFundingTime: number;
  time: number;
}

interface BinanceDepthResponse {
  lastUpdateId: number;
  bids: [string, string][];
  asks: [string, string][];
}

interface BinanceKlineItem extends Array<string | number> {
  // [openTime, open, high, low, close, volume, closeTime, ...]
}

interface Binance24hrResponse {
  symbol: string;
  volume: string;
  quoteVolume: string;
}

interface BinanceApiError {
  code: number;
  msg: string;
}

// ─── 재시도 설정 ───

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class BinanceService {
  private baseUrl: string;
  private timeoutMs: number;

  constructor() {
    const config = loadConfig();
    this.baseUrl = config.data_agent.binance.base_url;
    this.timeoutMs = config.data_agent.hyperliquid.request_timeout_ms || 5000;
  }

  /**
   * HTTP 요청 + Rate Limiter + AbortController 타임아웃 + exponential backoff 재시도
   */
  private async request<T>(
    endpoint: string,
    params?: Record<string, string | number>,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, String(v));
      }
    }

    // Rate limiter: 요청 전 토큰 소비 (endpoint별 weight 적용)
    const rateLimiter = getBinanceRateLimiter();
    const weight = BINANCE_WEIGHTS[endpoint] || 1;
    await rateLimiter.acquire(weight);

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
          const response = await fetch(url.toString(), {
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
          });

          if (!response.ok) {
            const text = await response.text();

            // 바이낸스 구조화된 에러 파싱
            let errorDetail: string;
            try {
              const apiErr: BinanceApiError = JSON.parse(text);
              errorDetail = `code=${apiErr.code}, msg="${apiErr.msg}"`;
            } catch {
              errorDetail = text;
            }

            // 429 (Rate Limit) → 추가 대기 후 재시도
            if (response.status === 429) {
              const retryAfter = response.headers.get("Retry-After");
              const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : 5000;
              logger.warn("Binance 429 rate limit hit, backing off", { endpoint, waitMs });
              await sleep(waitMs);
              throw new Error(`Binance API 429: ${errorDetail}`);
            }

            // 5xx는 재시도 가능
            if (response.status >= 500) {
              throw new Error(`Binance API ${response.status}: ${errorDetail}`);
            }

            // 4xx (클라이언트 에러)는 재시도 불가
            throw new RetryableError(
              `Binance API ${response.status}: ${errorDetail}`,
              false,
            );
          }

          return response.json() as Promise<T>;
        } finally {
          clearTimeout(timeout);
        }
      } catch (err) {
        if (err instanceof RetryableError && !err.retryable) {
          throw err; // 재시도 불가 에러는 즉시 throw
        }

        lastError = err instanceof Error ? err : new Error(String(err));

        if (attempt < MAX_RETRIES - 1) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          // 재시도 시에도 rate limiter를 통해 토큰 재소비
          await rateLimiter.acquire(weight);
          logger.warn(`API 요청 재시도 ${attempt + 1}/${MAX_RETRIES}`, {
            endpoint,
            error: lastError.message,
            next_retry_ms: delay,
          });
          await sleep(delay);
        }
      }
    }

    throw lastError || new Error("알 수 없는 에러");
  }

  async getMarkPrice(symbol: string): Promise<{ markPrice: number; fundingRate: number }> {
    const data = await this.request<BinanceMarkPriceResponse>(
      "/fapi/v1/premiumIndex",
      { symbol },
    );
    return {
      markPrice: parseFloat(data.markPrice),
      fundingRate: parseFloat(data.lastFundingRate),
    };
  }

  async getDepth(symbol: string, limit: number = 5): Promise<{ bestBid: number; bestAsk: number }> {
    const data = await this.request<BinanceDepthResponse>(
      "/fapi/v1/depth",
      { symbol, limit },
    );
    return {
      bestBid: data.bids.length > 0 ? parseFloat(data.bids[0][0]) : 0,
      bestAsk: data.asks.length > 0 ? parseFloat(data.asks[0][0]) : 0,
    };
  }

  async get24hrVolume(symbol: string): Promise<number> {
    const data = await this.request<Binance24hrResponse>(
      "/fapi/v1/ticker/24hr",
      { symbol },
    );
    return parseFloat(data.quoteVolume);
  }

  async getKlines(symbol: string, interval: string = "1m", limit: number = 100): Promise<CandleData[]> {
    const data = await this.request<BinanceKlineItem[]>(
      "/fapi/v1/klines",
      { symbol, interval, limit },
    );

    return data.map((k) => ({
      open: parseFloat(String(k[1])),
      high: parseFloat(String(k[2])),
      low: parseFloat(String(k[3])),
      close: parseFloat(String(k[4])),
      volume: parseFloat(String(k[5])),
    }));
  }

  async getFullData(binancePair: string): Promise<{
    markPrice: number;
    fundingRate: number;
    bid: number;
    ask: number;
    volume24h: number;
    candles: CandleData[];
  }> {
    const config = loadConfig();
    const [priceData, depthData, volume, candles] = await Promise.all([
      this.getMarkPrice(binancePair),
      this.getDepth(binancePair),
      this.get24hrVolume(binancePair),
      this.getKlines(binancePair, config.data_agent.candle_interval, config.data_agent.candle_lookback),
    ]);

    return {
      markPrice: priceData.markPrice,
      fundingRate: priceData.fundingRate,
      bid: depthData.bestBid,
      ask: depthData.bestAsk,
      volume24h: volume,
      candles,
    };
  }

  // ─── 추가 시장 데이터 (AI 자율 판단용) ───

  async getOpenInterest(symbol: string): Promise<{ openInterest: number; time: number } | null> {
    try {
      const data = await this.request<{ symbol: string; openInterest: string; time: number }>(
        "/fapi/v1/openInterest",
        { symbol },
      );
      return { openInterest: parseFloat(data.openInterest), time: data.time };
    } catch { return null; }
  }

  async getFundingRateHistory(symbol: string, limit: number = 8): Promise<Array<{
    fundingRate: number; fundingTime: number; markPrice: number;
  }>> {
    try {
      const data = await this.request<Array<{
        symbol: string; fundingRate: string; fundingTime: number; markPrice: string;
      }>>("/fapi/v1/fundingRate", { symbol, limit });
      return data.map(d => ({
        fundingRate: parseFloat(d.fundingRate),
        fundingTime: d.fundingTime,
        markPrice: parseFloat(d.markPrice),
      }));
    } catch { return []; }
  }

  async getLongShortRatio(symbol: string, period: string = "1h", limit: number = 5): Promise<Array<{
    longShortRatio: number; longAccount: number; shortAccount: number; timestamp: number;
  }>> {
    try {
      const data = await this.request<Array<{
        symbol: string; longShortRatio: string; longAccount: string; shortAccount: string; timestamp: number;
      }>>("/futures/data/globalLongShortAccountRatio", { symbol, period, limit });
      return data.map(d => ({
        longShortRatio: parseFloat(d.longShortRatio),
        longAccount: parseFloat(d.longAccount),
        shortAccount: parseFloat(d.shortAccount),
        timestamp: d.timestamp,
      }));
    } catch { return []; }
  }

  async getTopTraderLongShortRatio(symbol: string, period: string = "1h", limit: number = 5): Promise<Array<{
    longShortRatio: number; longAccount: number; shortAccount: number; timestamp: number;
  }>> {
    try {
      const data = await this.request<Array<{
        symbol: string; longShortRatio: string; longAccount: string; shortAccount: string; timestamp: number;
      }>>("/futures/data/topLongShortPositionRatio", { symbol, period, limit });
      return data.map(d => ({
        longShortRatio: parseFloat(d.longShortRatio),
        longAccount: parseFloat(d.longAccount),
        shortAccount: parseFloat(d.shortAccount),
        timestamp: d.timestamp,
      }));
    } catch { return []; }
  }

  async getTakerBuySellVolume(symbol: string, period: string = "1h", limit: number = 5): Promise<Array<{
    buySellRatio: number; buyVol: number; sellVol: number; timestamp: number;
  }>> {
    try {
      const data = await this.request<Array<{
        buySellRatio: string; sellVol: string; buyVol: string; timestamp: number;
      }>>("/futures/data/takerBuySellVol", { pair: symbol, contractType: "PERPETUAL", period, limit });
      return data.map(d => ({
        buySellRatio: parseFloat(d.buySellRatio),
        buyVol: parseFloat(d.buyVol),
        sellVol: parseFloat(d.sellVol),
        timestamp: d.timestamp,
      }));
    } catch { return []; }
  }

  async getMarketSentiment(symbol: string): Promise<{
    openInterest: number | null;
    fundingHistory: Array<{ rate: number; time: number }>;
    longShortRatio: { latest: number; trend: string } | null;
    topTraderRatio: { latest: number; trend: string } | null;
    takerVolume: { buySellRatio: number; trend: string } | null;
  }> {
    const [oi, fundingHist, lsRatio, topRatio, takerVol] = await Promise.all([
      this.getOpenInterest(symbol),
      this.getFundingRateHistory(symbol, 8),
      this.getLongShortRatio(symbol, "1h", 5),
      this.getTopTraderLongShortRatio(symbol, "1h", 5),
      this.getTakerBuySellVolume(symbol, "1h", 5),
    ]);

    const calcTrend = (arr: Array<{ longShortRatio?: number; buySellRatio?: number }>, key: 'longShortRatio' | 'buySellRatio'): string => {
      if (arr.length < 2) return "unknown";
      const first = (arr[0] as any)[key];
      const last = (arr[arr.length - 1] as any)[key];
      if (last > first * 1.05) return "increasing";
      if (last < first * 0.95) return "decreasing";
      return "stable";
    };

    return {
      openInterest: oi?.openInterest ?? null,
      fundingHistory: fundingHist.map(f => ({ rate: f.fundingRate, time: f.fundingTime })),
      longShortRatio: lsRatio.length > 0 ? {
        latest: lsRatio[lsRatio.length - 1].longShortRatio,
        trend: calcTrend(lsRatio, 'longShortRatio'),
      } : null,
      topTraderRatio: topRatio.length > 0 ? {
        latest: topRatio[topRatio.length - 1].longShortRatio,
        trend: calcTrend(topRatio, 'longShortRatio'),
      } : null,
      takerVolume: takerVol.length > 0 ? {
        buySellRatio: takerVol[takerVol.length - 1].buySellRatio,
        trend: calcTrend(takerVol, 'buySellRatio'),
      } : null,
    };
  }
}

// ─── 재시도 가능 여부를 구분하는 에러 ───

class RetryableError extends Error {
  retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "RetryableError";
    this.retryable = retryable;
  }
}
