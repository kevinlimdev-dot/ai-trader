/**
 * Coinbase Agentic Wallet 서비스
 *
 * awal CLI를 통해 Agentic Wallet을 제어한다.
 * - 잔고 조회: bunx awal balance --json
 * - 주소 조회: bunx awal address --json
 * - USDC 전송: bunx awal send <amount> <address> --json
 *
 * 사전 조건: `bunx awal auth login` + `bunx awal auth verify`로 인증 완료
 */

import { createLogger } from "../utils/logger";

const logger = createLogger("Coinbase:AW");

// ─── 실제 CLI 응답 타입 (검증됨) ───

interface AwalStatusResponse {
  server: { running: boolean; pid: number };
  auth: { authenticated: boolean; email: string };
}

interface AwalBalanceResponse {
  address: string;
  chain: string;
  balances: {
    USDC: { raw: string; formatted: string; decimals: number };
    ETH: { raw: string; formatted: string; decimals: number };
    WETH: { raw: string; formatted: string; decimals: number };
  };
  timestamp: string;
}

interface AwalCliResult {
  success: boolean;
  data?: unknown;
  error?: string;
  raw?: string;
}

interface AwalSendResult {
  status: string;
  txHash?: string;
  amount?: string;
  to?: string;
}

// ─── 설정 ───

const CLI_TIMEOUT_MS = 30_000;

/**
 * stdout에서 JSON 부분만 추출한다.
 * awal CLI는 "- Checking status..." 같은 프로그레스 라인을 출력한 뒤 JSON을 출력하므로
 * 마지막 유효 JSON 블록만 파싱한다.
 */
function extractJson(stdout: string): unknown | null {
  const trimmed = stdout.trim();

  // 문자열 전체가 JSON인 경우 (문자열 리터럴 "0x..." 포함)
  try {
    return JSON.parse(trimmed);
  } catch {
    // pass
  }

  // 마지막 { ... } 또는 [ ... ] 블록 추출
  const lastBrace = trimmed.lastIndexOf("}");
  const lastBracket = trimmed.lastIndexOf("]");
  const endIdx = Math.max(lastBrace, lastBracket);

  if (endIdx === -1) return null;

  const endChar = trimmed[endIdx];
  const startChar = endChar === "}" ? "{" : "[";

  // 중첩 깊이를 고려하여 매칭되는 시작 위치 찾기
  let depth = 0;
  for (let i = endIdx; i >= 0; i--) {
    if (trimmed[i] === endChar) depth++;
    if (trimmed[i] === startChar) depth--;
    if (depth === 0) {
      try {
        return JSON.parse(trimmed.slice(i, endIdx + 1));
      } catch {
        return null;
      }
    }
  }

  return null;
}

/**
 * awal CLI 명령을 실행하고 결과를 반환한다.
 */
async function runAwalCli(args: string[]): Promise<AwalCliResult> {
  const fullArgs = ["awal", ...args, "--json"];

  logger.debug("awal CLI 실행", { args: fullArgs });

  try {
    const proc = Bun.spawn(["bunx", ...fullArgs], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    });

    // 타임아웃 처리
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        proc.kill();
        reject(new Error(`awal CLI 타임아웃 (${CLI_TIMEOUT_MS}ms)`));
      }, CLI_TIMEOUT_MS);
    });

    const exitCode = await Promise.race([proc.exited, timeoutPromise]);

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    if (exitCode !== 0) {
      logger.error("awal CLI 실패", { exitCode, stderr, stdout });
      return {
        success: false,
        error: stderr.trim() || stdout.trim() || `Exit code: ${exitCode}`,
        raw: stdout,
      };
    }

    // JSON 추출 (프로그레스 라인 무시)
    const data = extractJson(stdout);
    if (data !== null) {
      return { success: true, data, raw: stdout };
    }

    // JSON이 아닌 출력도 성공으로 처리
    return { success: true, data: stdout.trim(), raw: stdout };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("awal CLI 실행 오류", { error: msg });
    return { success: false, error: msg };
  }
}

export class CoinbaseService {
  private cachedAddress: string | null = null;

  /**
   * 인증 상태 확인
   *
   * 실제 응답:
   * { server: { running: true, pid: 72251 },
   *   auth: { authenticated: true, email: "user@example.com" } }
   */
  async checkStatus(): Promise<{ authenticated: boolean; email?: string }> {
    const result = await runAwalCli(["status"]);

    if (!result.success) {
      return { authenticated: false };
    }

    const data = result.data as AwalStatusResponse;
    return {
      authenticated: data?.auth?.authenticated ?? false,
      email: data?.auth?.email,
    };
  }

  /**
   * 지갑 주소 조회 (캐시 포함)
   *
   * 실제 응답: "0xB9C971e2d682d4e90b1dd0eaCA7385e6887F3f76" (문자열)
   */
  async getAddress(): Promise<string> {
    if (this.cachedAddress) return this.cachedAddress;

    const result = await runAwalCli(["address"]);

    if (!result.success) {
      throw new Error(`지갑 주소 조회 실패: ${result.error}`);
    }

    let addr = "";
    // 문자열로 직접 반환됨
    if (typeof result.data === "string") {
      addr = result.data;
    } else {
      // 객체인 경우 address 필드 시도
      const data = result.data as Record<string, unknown>;
      addr = (data?.address as string) || "";
    }

    if (addr) this.cachedAddress = addr;
    return addr;
  }

  /**
   * USDC 잔고 조회 (Base 네트워크)
   *
   * 실제 응답:
   * { address: "0x...", chain: "Base",
   *   balances: { USDC: { raw: "0", formatted: "0.00", decimals: 6 }, ... } }
   */
  async getUsdcBalance(chain?: string): Promise<number> {
    const args = ["balance"];
    if (chain) args.push("--chain", chain);

    const result = await runAwalCli(args);

    if (!result.success) {
      throw new Error(`잔고 조회 실패: ${result.error}`);
    }

    const data = result.data as AwalBalanceResponse;

    if (typeof data === "object" && data !== null && data.balances) {
      const usdc = data.balances.USDC;
      if (usdc) {
        return parseFloat(usdc.formatted) || 0;
      }
    }

    return 0;
  }

  /**
   * 전체 잔고 조회 (모든 토큰)
   */
  async getBalances(): Promise<Record<string, number>> {
    const args = ["balance"];
    const result = await runAwalCli(args);

    if (!result.success) {
      throw new Error(`잔고 조회 실패: ${result.error}`);
    }

    const data = result.data as AwalBalanceResponse;
    const balances: Record<string, number> = {};

    if (typeof data === "object" && data !== null && data.balances) {
      for (const [token, info] of Object.entries(data.balances)) {
        const val = parseFloat((info as { formatted: string }).formatted);
        if (!isNaN(val)) {
          balances[token] = val;
        }
      }
    }

    return balances;
  }

  /**
   * USDC 전송
   */
  async sendUsdc(params: {
    amount: number;
    toAddress: string;
    chain?: string;
  }): Promise<AwalSendResult> {
    const { amount, toAddress, chain } = params;

    if (amount <= 0) {
      throw new Error("전송 금액은 0보다 커야 합니다");
    }

    logger.info("USDC 전송 시작", { amount, toAddress, chain });

    const args = ["send", amount.toString(), toAddress];
    if (chain) args.push("--chain", chain);

    const result = await runAwalCli(args);

    if (!result.success) {
      throw new Error(`USDC 전송 실패: ${result.error}`);
    }

    const data = result.data as Record<string, unknown> | null;

    const sendResult: AwalSendResult = {
      status: "completed",
      txHash: (data?.txHash as string)
        || (data?.tx_hash as string)
        || (data?.transactionHash as string)
        || undefined,
      amount: amount.toString(),
      to: toAddress,
    };

    logger.info("USDC 전송 완료", sendResult);
    return sendResult;
  }

  /**
   * 하이퍼리퀴드로 자금 전송 (Base USDC → HyperLiquid 입금 주소)
   */
  async fundHyperliquid(amount: number): Promise<AwalSendResult> {
    const depositAddress = process.env.HYPERLIQUID_DEPOSIT_ADDRESS;
    if (!depositAddress) {
      throw new Error("HYPERLIQUID_DEPOSIT_ADDRESS가 설정되지 않았습니다");
    }

    return this.sendUsdc({
      amount,
      toAddress: depositAddress,
    });
  }

  /**
   * 토큰 트레이드 (Base 네트워크에서 스왑)
   */
  async trade(
    amount: number,
    fromToken: string,
    toToken: string,
  ): Promise<unknown> {
    const args = ["trade", amount.toString(), fromToken, toToken];
    const result = await runAwalCli(args);

    if (!result.success) {
      throw new Error(`트레이드 실패: ${result.error}`);
    }

    return result.data;
  }
}
