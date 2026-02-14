import { HttpTransport, InfoClient, ExchangeClient } from "@nktkas/hyperliquid";
import { createLogger } from "../utils/logger";
import { loadConfig } from "../utils/config";

const logger = createLogger("HyperLiquid");

export class HyperliquidService {
  private infoClient: InfoClient;
  private exchangeClient: ExchangeClient | null = null;
  private userAddress: string | null = null;

  constructor() {
    const config = loadConfig();
    const transport = new HttpTransport({
      apiUrl: config.trade_agent.hyperliquid.base_url,
    });
    this.infoClient = new InfoClient({ transport });
  }

  async initWallet(privateKey: string): Promise<void> {
    // viem은 devDependencies가 아니므로 dynamic import
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

  async getMeta(): Promise<any> {
    return this.infoClient.meta();
  }

  private async getCoinIndex(coin: string): Promise<number> {
    const meta = await this.getMeta();
    const idx = meta.universe.findIndex((u: any) => u.name === coin);
    if (idx === -1) throw new Error(`코인을 찾을 수 없습니다: ${coin}`);
    return idx;
  }

  // ─── User State ───

  async getUserState(): Promise<any> {
    if (!this.userAddress) throw new Error("지갑이 초기화되지 않았습니다");
    return this.infoClient.clearinghouseState({ user: this.userAddress as `0x${string}` });
  }

  async getBalance(): Promise<number> {
    const state = await this.getUserState();
    return parseFloat(state.marginSummary.accountValue);
  }

  async getOpenPositions(): Promise<any[]> {
    const state = await this.getUserState();
    return state.assetPositions.filter(
      (p: any) => parseFloat(p.position.szi) !== 0,
    );
  }

  // ─── Trading ───

  async placeMarketOrder(params: {
    coin: string;
    isBuy: boolean;
    size: number;
    reduceOnly?: boolean;
  }): Promise<any> {
    if (!this.exchangeClient) throw new Error("지갑이 초기화되지 않았습니다");

    const { coin, isBuy, size, reduceOnly = false } = params;
    const assetIndex = await this.getCoinIndex(coin);

    // 현재 mid price 가져와서 slippage 적용한 limit price 설정
    const midPrice = await this.getMidPrice(coin);
    const config = loadConfig();
    const slippage = config.trade_agent.hyperliquid.slippage;
    const limitPx = isBuy
      ? (midPrice * (1 + slippage)).toFixed(1)
      : (midPrice * (1 - slippage)).toFixed(1);

    logger.info("시장가 주문 실행", { coin, isBuy, size, reduceOnly, limitPx });

    const result = await this.exchangeClient.order({
      orders: [
        {
          a: assetIndex,
          b: isBuy,
          p: limitPx,
          s: size.toString(),
          r: reduceOnly,
          t: { limit: { tif: "Ioc" as const } },
        },
      ],
      grouping: "na",
    });

    logger.info("주문 결과", result);
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
      const coin = pos.position.coin as string;
      const size = Math.abs(parseFloat(pos.position.szi));
      const isBuy = parseFloat(pos.position.szi) < 0;

      await this.placeMarketOrder({ coin, isBuy, size, reduceOnly: true });
      logger.info("포지션 청산", { coin, size, side: isBuy ? "BUY" : "SELL" });
    }
  }
}
