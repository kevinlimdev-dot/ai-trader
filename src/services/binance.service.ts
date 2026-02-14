import { createLogger } from "../utils/logger";
import { loadConfig } from "../utils/config";
import type { CandleData } from "../models/price-snapshot";

const logger = createLogger("Binance");

// 바이낸스 선물 REST API 직접 호출 (공식 SDK 대신 경량 구현)
// 가격 조회에는 API 키 불필요 (public endpoints)

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

interface BinanceKlineResponse {
  // [openTime, open, high, low, close, volume, closeTime, ...]
  [index: number]: string | number;
}

interface Binance24hrResponse {
  symbol: string;
  volume: string;
  quoteVolume: string;
}

export class BinanceService {
  private baseUrl: string;

  constructor() {
    const config = loadConfig();
    this.baseUrl = config.data_agent.binance.base_url;
  }

  private async request<T>(endpoint: string, params?: Record<string, string | number>): Promise<T> {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, String(v));
      }
    }

    const response = await fetch(url.toString(), {
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Binance API error ${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
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
    const data = await this.request<any[][]>(
      "/fapi/v1/klines",
      { symbol, interval, limit },
    );

    return data.map((k) => ({
      open: parseFloat(k[1] as string),
      high: parseFloat(k[2] as string),
      low: parseFloat(k[3] as string),
      close: parseFloat(k[4] as string),
      volume: parseFloat(k[5] as string),
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
}
