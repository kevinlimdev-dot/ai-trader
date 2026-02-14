import { createLogger } from "../utils/logger";
import { loadConfig } from "../utils/config";

const logger = createLogger("Coinbase");

interface CoinbaseBalance {
  currency: string;
  amount: string;
}

interface CoinbaseSendResult {
  id: string;
  status: string;
  tx_hash?: string;
}

export class CoinbaseService {
  private baseUrl: string;
  private walletId: string;
  private headers: Record<string, string>;

  constructor() {
    const config = loadConfig();
    this.baseUrl = config.wallet_agent.coinbase.base_url;
    this.walletId = process.env.COINBASE_WALLET_ID || "";

    this.headers = {
      Authorization: `Bearer ${process.env.COINBASE_API_KEY}`,
      "Content-Type": "application/json",
      "X-Wallet-Secret": process.env.COINBASE_WALLET_SECRET || "",
    };
  }

  private async request<T>(
    endpoint: string,
    options?: RequestInit,
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: { ...this.headers, ...options?.headers },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Coinbase API error ${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
  }

  async getBalances(): Promise<Record<string, number>> {
    const data = await this.request<{ data: CoinbaseBalance[] }>(
      `/wallets/${this.walletId}/balances`,
    );

    const balances: Record<string, number> = {};
    for (const b of data.data) {
      balances[b.currency] = parseFloat(b.amount);
    }
    return balances;
  }

  async getUsdcBalance(): Promise<number> {
    const balances = await this.getBalances();
    return balances["USDC"] || 0;
  }

  async sendUsdc(params: {
    amount: number;
    toAddress: string;
    network?: string;
  }): Promise<CoinbaseSendResult> {
    const config = loadConfig();
    const { amount, toAddress, network } = params;

    logger.info("USDC 전송 시작", { amount, toAddress, network });

    const result = await this.request<{ data: CoinbaseSendResult }>(
      `/wallets/${this.walletId}/send`,
      {
        method: "POST",
        body: JSON.stringify({
          currency: "USDC",
          amount: amount.toString(),
          to_address: toAddress,
          network: network || config.wallet_agent.coinbase.transfer_network,
        }),
      },
    );

    logger.info("USDC 전송 완료", result.data);
    return result.data;
  }

  async fundHyperliquid(amount: number): Promise<CoinbaseSendResult> {
    const depositAddress = process.env.HYPERLIQUID_DEPOSIT_ADDRESS;
    if (!depositAddress) {
      throw new Error("HYPERLIQUID_DEPOSIT_ADDRESS가 설정되지 않았습니다");
    }

    return this.sendUsdc({
      amount,
      toAddress: depositAddress,
    });
  }
}
