/**
 * data-collector 스킬 스크립트
 * 바이낸스 선물 + 하이퍼리퀴드 가격 데이터를 수집하여 스냅샷을 저장한다.
 *
 * 사용법:
 *   bun run skills/data-collector/scripts/collect-prices.ts
 *   bun run skills/data-collector/scripts/collect-prices.ts --symbol BTC
 */

import { resolve } from "path";
import { BinanceService } from "../../../src/services/binance.service";
import { HyperliquidService } from "../../../src/services/hyperliquid.service";
import { loadConfig, getProjectRoot } from "../../../src/utils/config";
import { createLogger } from "../../../src/utils/logger";
import { atomicWrite } from "../../../src/utils/file";
import { insertSnapshot, getLatestSnapshotPrice, cleanupOldSnapshots, closeDb } from "../../../src/db/repository";
import type { PriceSnapshot, SnapshotCollection } from "../../../src/models/price-snapshot";

const logger = createLogger("DataCollector");

// ─── Graceful Shutdown ───
function setupGracefulShutdown(): void {
  const cleanup = () => { closeDb(); process.exit(0); };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

// CLI 인자 파싱
function parseArgs(): { symbol?: string } {
  const args = process.argv.slice(2);
  const symbolIdx = args.indexOf("--symbol");
  return {
    symbol: symbolIdx >= 0 ? args[symbolIdx + 1] : undefined,
  };
}

// ─── 이상치 감지 ───

function detectAnomaly(
  symbol: string,
  newBinancePrice: number,
  newHlPrice: number,
): { anomaly: boolean; details?: string } {
  const prevPrice = getLatestSnapshotPrice(symbol);
  if (!prevPrice) {
    return { anomaly: false }; // 첫 수집에서는 비교 대상 없음
  }

  const config = loadConfig();
  const ANOMALY_THRESHOLD = config.data_agent.anomaly_threshold_pct || 0.10;

  const binanceChange = Math.abs((newBinancePrice - prevPrice.binance) / prevPrice.binance);
  const hlChange = Math.abs((newHlPrice - prevPrice.hl) / prevPrice.hl);

  if (binanceChange >= ANOMALY_THRESHOLD) {
    const detail = `바이낸스 가격 급변: ${prevPrice.binance} → ${newBinancePrice} (${(binanceChange * 100).toFixed(2)}%)`;
    logger.warn("이상치 감지", { symbol, detail });
    return { anomaly: true, details: detail };
  }

  if (hlChange >= ANOMALY_THRESHOLD) {
    const detail = `하이퍼리퀴드 가격 급변: ${prevPrice.hl} → ${newHlPrice} (${(hlChange * 100).toFixed(2)}%)`;
    logger.warn("이상치 감지", { symbol, detail });
    return { anomaly: true, details: detail };
  }

  return { anomaly: false };
}

async function collectForSymbol(
  binance: BinanceService,
  hl: HyperliquidService,
  symbolConfig: { symbol: string; binance_pair: string; hyperliquid_pair: string },
  hlMidPrices?: Record<string, number>,
): Promise<PriceSnapshot> {
  const { symbol, binance_pair, hyperliquid_pair } = symbolConfig;

  // 병렬로 두 거래소 데이터 수집
  // hlMidPrices가 미리 전달되면 API 호출 절약 (50개 코인 최적화)
  const [binanceData, hlBook] = await Promise.all([
    binance.getFullData(binance_pair),
    hl.getL2Book(hyperliquid_pair),
  ]);

  const hlMid = hlMidPrices?.[hyperliquid_pair] ?? await hl.getMidPrice(hyperliquid_pair);

  // 스프레드 계산
  const binanceMid = binanceData.markPrice;
  const hlMidPrice = hlMid;
  const spreadAbsolute = binanceMid - hlMidPrice;
  const spreadPct = hlMidPrice > 0 ? Math.abs(spreadAbsolute) / hlMidPrice : 0;
  const direction = spreadAbsolute >= 0 ? "binance_higher" : "binance_lower";

  // 이상치 감지 (이전 가격 대비 ±10% 이상 변동)
  const anomalyResult = detectAnomaly(symbol, binanceMid, hlMidPrice);

  const snapshot: PriceSnapshot = {
    timestamp: new Date().toISOString(),
    symbol,
    binance: {
      mark_price: binanceData.markPrice,
      bid: binanceData.bid,
      ask: binanceData.ask,
      volume_24h: binanceData.volume24h,
      funding_rate: binanceData.fundingRate,
    },
    hyperliquid: {
      mid_price: hlMidPrice,
      bid: hlBook.bestBid,
      ask: hlBook.bestAsk,
    },
    spread: {
      absolute: Math.abs(spreadAbsolute),
      percentage: spreadPct,
      direction: direction as "binance_higher" | "binance_lower",
    },
    candles_1m: binanceData.candles,
    anomaly: anomalyResult.anomaly,
  };

  return snapshot;
}

async function main(): Promise<void> {
  setupGracefulShutdown();

  const config = loadConfig();
  const args = parseArgs();
  const root = getProjectRoot();

  const binance = new BinanceService();
  const hl = new HyperliquidService();

  // 수집할 심볼 결정
  let symbols = config.data_agent.symbols;
  if (args.symbol) {
    symbols = symbols.filter((s) => s.symbol === args.symbol!.toUpperCase());
    if (symbols.length === 0) {
      console.error(JSON.stringify({ status: "error", error: `알 수 없는 심볼: ${args.symbol}` }));
      process.exit(1);
    }
  }

  const snapshots: PriceSnapshot[] = [];
  const errors: string[] = [];
  const anomalies: string[] = [];

  // HL mid prices를 한 번만 가져와서 재사용 (50개 코인 최적화)
  let hlMidPrices: Record<string, number> = {};
  try {
    hlMidPrices = await hl.getAllMidPrices();
    logger.info("HL mid prices 일괄 조회 완료", { count: Object.keys(hlMidPrices).length });
  } catch (err) {
    logger.warn("HL mid prices 일괄 조회 실패, 개별 조회로 전환", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  for (const sym of symbols) {
    let retries = 3;
    while (retries > 0) {
      try {
        const snapshot = await collectForSymbol(binance, hl, sym, hlMidPrices);
        snapshots.push(snapshot);

        // 이상치 플래그 기록
        if (snapshot.anomaly) {
          anomalies.push(`${sym.symbol}: 가격 급변 감지`);
        }

        // DB에 저장
        insertSnapshot(snapshot);

        logger.info(`${sym.symbol} 가격 수집 완료`, {
          binance: snapshot.binance.mark_price,
          hl: snapshot.hyperliquid.mid_price,
          spread_pct: (snapshot.spread.percentage * 100).toFixed(4) + "%",
          anomaly: snapshot.anomaly,
        });
        break;
      } catch (err) {
        retries--;
        const msg = err instanceof Error ? err.message : String(err);
        if (retries === 0) {
          errors.push(`${sym.symbol}: ${msg}`);
          logger.error(`${sym.symbol} 수집 실패`, { error: msg });
        } else {
          logger.warn(`${sym.symbol} 수집 재시도 (남은: ${retries})`, { error: msg });
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }
  }

  // 양쪽 모두 데이터 없음 → no_data
  if (snapshots.length === 0 && errors.length === 0) {
    console.log(JSON.stringify({ status: "no_data", message: "수집할 데이터가 없습니다." }));
    return;
  }

  // 파일로 저장
  if (snapshots.length > 0) {
    const collection: SnapshotCollection = {
      collected_at: new Date().toISOString(),
      snapshots,
    };

    const snapshotPath = resolve(root, "data/snapshots/latest.json");
    await atomicWrite(snapshotPath, collection);
  }

  // 오래된 스냅샷 정리
  const maxPerSymbol = config.data_agent.storage.max_snapshots_per_symbol;
  cleanupOldSnapshots(maxPerSymbol);

  // 결과 출력 (OpenClaw 에이전트가 stdout으로 읽음)
  const status = errors.length === 0
    ? "success"
    : snapshots.length > 0
      ? "partial"
      : errors.length > 0 && snapshots.length === 0
        ? "error"
        : "no_data";

  const result = {
    status,
    collected: snapshots.length,
    errors: errors.length > 0 ? errors : undefined,
    anomalies: anomalies.length > 0 ? anomalies : undefined,
    snapshots: snapshots.map((s) => ({
      symbol: s.symbol,
      binance_price: s.binance.mark_price,
      hl_price: s.hyperliquid.mid_price,
      spread_pct: (s.spread.percentage * 100).toFixed(4) + "%",
      direction: s.spread.direction,
      anomaly: s.anomaly,
    })),
  };

  console.log(JSON.stringify(result, null, 2));

  if (errors.length > 0 && snapshots.length === 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(JSON.stringify({
    status: "error",
    error: err instanceof Error ? err.message : String(err),
    retryable: true,
  }));
  process.exit(1);
});
