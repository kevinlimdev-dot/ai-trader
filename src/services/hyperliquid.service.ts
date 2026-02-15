import { HttpTransport, InfoClient, ExchangeClient } from "@nktkas/hyperliquid";
import { createLogger } from "../utils/logger";
import { loadConfig } from "../utils/config";

const logger = createLogger("HyperLiquid");

// ─── SDK 응답 타입 정의 ───

interface HlMarginSummary {
  accountValue: string;
  totalMarginUsed: string;
  totalNtlPos: string;
  totalRawUsd: string;
}

interface HlPosition {
  coin: string;
  szi: string;
  entryPx: string;
  positionValue: string;
  unrealizedPnl: string;
  leverage: { type: string; value: number };
  liquidationPx: string | null;
}

interface HlAssetPosition {
  position: HlPosition;
  type: string;
}

interface HlUserState {
  marginSummary: HlMarginSummary;
  assetPositions: HlAssetPosition[];
  crossMarginSummary: HlMarginSummary;
}

interface HlMetaUniverse {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  onlyIsolated: boolean;
}

interface HlMeta {
  universe: HlMetaUniverse[];
}

interface HlOrderResult {
  status: "ok" | "err";
  response?: {
    type: string;
    data?: {
      statuses: Array<{
        resting?: { oid: number };
        filled?: { totalSz: string; avgPx: string; oid: number };
        error?: string;
      }>;
    };
  };
}

// ─── 서비스 클래스 ───

export class HyperliquidService {
  private infoClient: InfoClient;
  private exchangeClient: ExchangeClient | null = null;
  private userAddress: string | null = null;
  private metaCache: HlMeta | null = null;
  private metaCacheTime: number = 0;
  private static META_TTL_MS = 60_000; // 1분 캐시

  constructor() {
    const config = loadConfig();
    const transport = new HttpTransport({
      apiUrl: config.trade_agent.hyperliquid.base_url,
    });
    this.infoClient = new InfoClient({ transport });
  }

  async initWallet(privateKey: string): Promise<void> {
    const viemAccounts = await import("viem/accounts") as any;
    const account = viemAccounts.privateKeyToAccount(privateKey as `0x${string}`);
    this.userAddress = account.address;

    const config = loadConfig();
    const transport = new HttpTransport({
      apiUrl: config.trade_agent.hyperliquid.base_url,
    });
    this.exchangeClient = new ExchangeClient({ wallet: account, transport });
    logger.info("지갑 초기화 완료", { address: this.userAddress });
  }

  // ─── Public API ───

  async getAllMidPrices(): Promise<Record<string, number>> {
    const mids = await this.infoClient.allMids();
    const result: Record<string, number> = {};
    for (const [coin, price] of Object.entries(mids)) {
      result[coin] = parseFloat(price as string);
    }
    return result;
  }

  async getL2Book(coin: string): Promise<{ bestBid: number; bestAsk: number }> {
    const book = await this.infoClient.l2Book({ coin });
    if (!book || !book.levels) {
      return { bestBid: 0, bestAsk: 0 };
    }
    const levels = book.levels;
    return {
      bestBid: levels[0]?.length > 0 ? parseFloat(levels[0][0].px) : 0,
      bestAsk: levels[1]?.length > 0 ? parseFloat(levels[1][0].px) : 0,
    };
  }

  async getMidPrice(coin: string): Promise<number> {
    const allMids = await this.getAllMidPrices();
    return allMids[coin] || 0;
  }

  async getMeta(): Promise<HlMeta> {
    const now = Date.now();
    if (this.metaCache && (now - this.metaCacheTime) < HyperliquidService.META_TTL_MS) {
      return this.metaCache;
    }
    const meta = await this.infoClient.meta() as HlMeta;
    this.metaCache = meta;
    this.metaCacheTime = now;
    return meta;
  }

  private async getCoinIndex(coin: string): Promise<number> {
    const meta = await this.getMeta();
    const idx = meta.universe.findIndex((u) => u.name === coin);
    if (idx === -1) throw new Error(`코인을 찾을 수 없습니다: ${coin}`);
    return idx;
  }

  /**
   * 코인의 소수점 자릿수를 가져온다 (주문 크기 포맷용)
   */
  async getSzDecimals(coin: string): Promise<number> {
    const meta = await this.getMeta();
    const asset = meta.universe.find((u) => u.name === coin);
    return asset?.szDecimals ?? 3;
  }

  // ─── User State ───

  async getUserState(): Promise<HlUserState> {
    if (!this.userAddress) throw new Error("지갑이 초기화되지 않았습니다");
    return this.infoClient.clearinghouseState({
      user: this.userAddress as `0x${string}`,
    }) as Promise<HlUserState>;
  }

  async getBalance(): Promise<number> {
    const state = await this.getUserState();
    return parseFloat(state.marginSummary.accountValue);
  }

  async getOpenPositions(): Promise<HlAssetPosition[]> {
    const state = await this.getUserState();
    return state.assetPositions.filter(
      (p) => parseFloat(p.position.szi) !== 0,
    );
  }

  // ─── Trading ───

  async placeMarketOrder(params: {
    coin: string;
    isBuy: boolean;
    size: number;
    reduceOnly?: boolean;
  }): Promise<HlOrderResult> {
    if (!this.exchangeClient) throw new Error("지갑이 초기화되지 않았습니다");

    const { coin, isBuy, size, reduceOnly = false } = params;
    const assetIndex = await this.getCoinIndex(coin);

    // 사이즈 소수점 맞추기
    const szDecimals = await this.getSzDecimals(coin);
    const formattedSize = parseFloat(size.toFixed(szDecimals)).toString();

    // 현재 mid price 가져와서 slippage 적용한 limit price 설정
    const midPrice = await this.getMidPrice(coin);
    if (midPrice === 0) {
      throw new Error(`${coin} 중간 가격을 가져올 수 없습니다`);
    }

    const config = loadConfig();
    const slippage = config.trade_agent.hyperliquid.slippage;
    const limitPx = isBuy
      ? (midPrice * (1 + slippage)).toFixed(1)
      : (midPrice * (1 - slippage)).toFixed(1);

    logger.info("시장가 주문 실행", { coin, isBuy, size: formattedSize, reduceOnly, limitPx });

    const result = await this.exchangeClient.order({
      orders: [
        {
          a: assetIndex,
          b: isBuy,
          p: limitPx,
          s: formattedSize,
          r: reduceOnly,
          t: { limit: { tif: "Ioc" as const } },
        },
      ],
      grouping: "na",
    }) as HlOrderResult;

    // ─── 주문 결과 검증 ───
    if (result.status === "err") {
      const errMsg = typeof result.response === "string"
        ? result.response
        : JSON.stringify(result.response);
      logger.error("주문 실패", { coin, error: errMsg });
      throw new Error(`주문 실패: ${errMsg}`);
    }

    // 개별 주문 상태 확인
    const statuses = result.response?.data?.statuses;
    if (statuses && statuses.length > 0) {
      const first = statuses[0];
      if (first.error) {
        logger.error("주문 에러", { coin, error: first.error });
        throw new Error(`주문 에러: ${first.error}`);
      }
      if (first.filled) {
        logger.info("주문 체결 완료", {
          coin,
          filled_size: first.filled.totalSz,
          avg_price: first.filled.avgPx,
          oid: first.filled.oid,
        });
      } else if (first.resting) {
        logger.warn("주문 미체결 (resting)", { coin, oid: first.resting.oid });
      }
    }

    return result;
  }

  async setLeverage(coin: string, leverage: number, isCross: boolean = true): Promise<void> {
    if (!this.exchangeClient) throw new Error("지갑이 초기화되지 않았습니다");

    const assetIndex = await this.getCoinIndex(coin);
    await this.exchangeClient.updateLeverage({
      asset: assetIndex,
      isCross,
      leverage,
    });
    logger.info("레버리지 설정", { coin, leverage, isCross });
  }

  async closeAllPositions(): Promise<void> {
    const positions = await this.getOpenPositions();
    for (const pos of positions) {
      const coin = pos.position.coin;
      const size = Math.abs(parseFloat(pos.position.szi));
      const isBuy = parseFloat(pos.position.szi) < 0;

      try {
        await this.placeMarketOrder({ coin, isBuy, size, reduceOnly: true });
        logger.info("포지션 청산", { coin, size, side: isBuy ? "BUY" : "SELL" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error("포지션 청산 실패", { coin, error: msg });
      }
    }
  }

  // ─── Withdraw (HL → External) ───

  async withdraw(params: {
    amount: string;
    destination: string;
  }): Promise<{ status: string; response?: unknown }> {
    if (!this.exchangeClient) throw new Error("지갑이 초기화되지 않았습니다");

    const { amount, destination } = params;

    logger.info("출금 요청", { amount, destination });

    const result = await this.exchangeClient.withdraw3({
      destination: destination as `0x${string}`,
      amount,
    });

    // 결과 검증
    const res = result as { status: string; response?: unknown };
    if (res.status === "err") {
      const errMsg = typeof res.response === "string" ? res.response : JSON.stringify(res.response);
      throw new Error(`출금 실패: ${errMsg}`);
    }

    logger.info("출금 결과", result);
    return res;
  }
}
