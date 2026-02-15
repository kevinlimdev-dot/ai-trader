import { createLogger } from "../utils/logger";
import { loadConfig } from "../utils/config";

const logger = createLogger("Coinbase");

// ─── 응답 타입 정의 ───

interface CoinbaseBalance {
  currency: string;
  amount: string;
}

interface CoinbaseSendResult {
  id: string;
  status: string;
  tx_hash?: string;
}

interface CoinbaseApiError {
  errors?: Array<{ id: string; message: string }>;
  message?: string;
}

// ─── 재시도 설정 ───

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;
const REQUEST_TIMEOUT_MS = 10_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

  /**
   * HTTP 요청 + 타임아웃 + exponential backoff 재시도
   */
  private async request<T>(
    endpoint: string,
    options?: RequestInit,
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        try {
          const response = await fetch(url, {
            ...options,
            headers: { ...this.headers, ...options?.headers },
            signal: controller.signal,
          });

          if (!response.ok) {
            const text = await response.text();

            // Coinbase 구조화된 에러 파싱
            let errorDetail: string;
            try {
              const apiErr: CoinbaseApiError = JSON.parse(text);
              if (apiErr.errors && apiErr.errors.length > 0) {
                errorDetail = apiErr.errors.map((e) => `[${e.id}] ${e.message}`).join("; ");
              } else if (apiErr.message) {
                errorDetail = apiErr.message;
              } else {
                errorDetail = text;
              }
            } catch {
              errorDetail = text;
            }

            // 429, 5xx는 재시도
            if (response.status === 429 || response.status >= 500) {
              throw new Error(`Coinbase API ${response.status}: ${errorDetail}`);
            }

            // 4xx는 재시도 불가
            throw new NonRetryableError(`Coinbase API ${response.status}: ${errorDetail}`);
          }

          return response.json() as Promise<T>;
        } finally {
          clearTimeout(timeout);
        }
      } catch (err) {
        if (err instanceof NonRetryableError) {
          throw err;
        }

        lastError = err instanceof Error ? err : new Error(String(err));

        if (attempt < MAX_RETRIES - 1) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          logger.warn(`Coinbase API 재시도 ${attempt + 1}/${MAX_RETRIES}`, {
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

  async getBalances(): Promise<Record<string, number>> {
    if (!this.walletId) {
      throw new Error("COINBASE_WALLET_ID가 설정되지 않았습니다");
    }

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
    if (!this.walletId) {
      throw new Error("COINBASE_WALLET_ID가 설정되지 않았습니다");
    }

    const config = loadConfig();
    const { amount, toAddress, network } = params;

    if (amount <= 0) {
      throw new Error("전송 금액은 0보다 커야 합니다");
    }

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

    logger.info("USDC 전송 완료", {
      id: result.data.id,
      status: result.data.status,
      tx_hash: result.data.tx_hash,
    });
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

// ─── 재시도 불가 에러 ───

class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableError";
  }
}
