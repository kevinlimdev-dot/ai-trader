#!/usr/bin/env bun
/**
 * Position Monitor — 독립 포지션 감시 프로세스
 *
 * 열린 포지션의 SL/TP/트레일링 스탑을 15초 주기로 체크합니다.
 * Runner 또는 대시보드에서 자동 시작되며, 포지션이 없으면 자동 종료합니다.
 *
 * Usage:
 *   bun run src/position-monitor.ts           # 15초 주기 모니터링
 *   bun run src/position-monitor.ts --once    # 1회 체크 후 종료
 *   bun run src/position-monitor.ts --interval 10  # 10초 주기
 */
import { resolve } from "path";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { HyperliquidService } from "./services/hyperliquid.service";
import { RiskManager } from "./utils/risk-manager";
import { loadConfig, isPaperMode, getProjectRoot, getStrategy } from "./utils/config";
import { getStrategyPreset } from "./strategies/presets";
import { createLogger } from "./utils/logger";
import {
	getOpenTrades,
	updateTrade,
	closeDb,
} from "./db/repository";
import type { ExitReason } from "./models/order";

const logger = createLogger("PositionMonitor");
const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const STATUS_FILE = "/tmp/ai-trader-monitor-status.json";
const CONTROL_FILE = "/tmp/ai-trader-monitor-control.json";
const DEFAULT_INTERVAL = 15; // 15초
const IDLE_EXIT_CYCLES = 20; // 포지션 없이 20 사이클(5분) 지나면 종료

// ─── CLI 파싱 ───

function parseArgs() {
	const args = process.argv.slice(2);
	const intervalIdx = args.indexOf("--interval");
	return {
		once: args.includes("--once"),
		interval: intervalIdx >= 0 ? parseInt(args[intervalIdx + 1], 10) : DEFAULT_INTERVAL,
	};
}

// ─── 상태 관리 ───

interface MonitorStatus {
	state: "running" | "idle" | "stopped";
	pid: number;
	startedAt: string;
	checkCount: number;
	closedCount: number;
	openPositions: number;
	lastCheckAt: string | null;
	intervalSec: number;
	updatedAt: string;
}

function writeStatus(status: MonitorStatus) {
	try {
		writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2));
	} catch {}
}

function readControl(): string | null {
	try {
		if (!existsSync(CONTROL_FILE)) return null;
		const raw = readFileSync(CONTROL_FILE, "utf-8");
		const data = JSON.parse(raw);
		unlinkSync(CONTROL_FILE);
		return data.command || null;
	} catch {
		return null;
	}
}

// ─── 가격 조회 ───

async function getCurrentPrice(hl: HyperliquidService, symbol: string): Promise<number> {
	try {
		const price = await hl.getMidPrice(symbol);
		if (price > 0) return price;
	} catch {}

	// 폴백: 스냅샷
	const snapshotPath = resolve(PROJECT_ROOT, "data/snapshots/latest.json");
	if (existsSync(snapshotPath)) {
		try {
			const raw = readFileSync(snapshotPath, "utf-8");
			const collection = JSON.parse(raw);
			const snap = collection.snapshots?.find((s: any) => s.symbol === symbol);
			if (snap?.hyperliquid?.mid_price) return snap.hyperliquid.mid_price;
			if (snap?.binance?.mark_price) return snap.binance.mark_price;
		} catch {}
	}
	return 0;
}

// ─── API 호출 래퍼 ───

async function safeApiCall<T>(fn: () => Promise<T>): Promise<T> {
	return fn();
}

// ─── 모니터 사이클 ───

interface CheckResult {
	positions: number;
	closed: number;
	details: any[];
}

async function checkPositions(hl: HyperliquidService, risk: RiskManager, tradePreset?: { stopLoss: { atr_multiplier: number }; takeProfit: { atr_multiplier: number } }): Promise<CheckResult> {
	const openTrades = getOpenTrades();
	if (openTrades.length === 0) {
		return { positions: 0, closed: 0, details: [] };
	}

	let closedCount = 0;
	const details: any[] = [];

	for (const trade of openTrades) {
		let currentPrice: number;
		try {
			currentPrice = await getCurrentPrice(hl, trade.symbol);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			details.push({ symbol: trade.symbol, error: msg });
			continue;
		}

		if (currentPrice <= 0) {
			details.push({ symbol: trade.symbol, error: "가격 조회 실패" });
			continue;
		}

		const direction = trade.side === "LONG" ? 1 : -1;
		const pnl = (currentPrice - trade.entry_price) * direction * trade.size;
		const pnlPct = ((currentPrice - trade.entry_price) / trade.entry_price) * direction * 100;

		// DB에서 SL/TP 가져오기 — 폴백: 프리셋 ATR 비율 기반
		const slFallbackPct = (tradePreset?.stopLoss.atr_multiplier ?? 1.5) * 0.02;
		const tpFallbackPct = (tradePreset?.takeProfit.atr_multiplier ?? 3.0) * 0.02;
		const stopLoss = trade.stop_loss || (trade.side === "LONG"
			? trade.entry_price * (1 - slFallbackPct)
			: trade.entry_price * (1 + slFallbackPct));
		const takeProfit = trade.take_profit || (trade.side === "LONG"
			? trade.entry_price * (1 + tpFallbackPct)
			: trade.entry_price * (1 - tpFallbackPct));

		// Peak PnL 업데이트 — 수익 방향만 추적
		const prevPeak = trade.peak_pnl_pct || 0;
		const profitPnlPct = Math.max(0, pnlPct);
		const newPeak = Math.max(prevPeak, profitPnlPct);
		if (newPeak > prevPeak) {
			updateTrade(trade.trade_id, { peak_pnl_pct: newPeak });
		}

		let exitReason: string | null = null;

		// Stop Loss
		if (trade.side === "LONG" && currentPrice <= stopLoss) {
			exitReason = "stop_loss";
		} else if (trade.side === "SHORT" && currentPrice >= stopLoss) {
			exitReason = "stop_loss";
		}

		// Take Profit
		if (!exitReason) {
			if (trade.side === "LONG" && currentPrice >= takeProfit) {
				exitReason = "take_profit";
			} else if (trade.side === "SHORT" && currentPrice <= takeProfit) {
				exitReason = "take_profit";
			}
		}

		// Progressive Trailing Stop — 수익이 커질수록 추적 폭이 좁아짐
		if (!exitReason && pnlPct > 0) {
			const isActivated = trade.trailing_activated === 1 || risk.shouldActivateTrailingStop(pnlPct);

			if (isActivated && trade.trailing_activated !== 1) {
				updateTrade(trade.trade_id, { trailing_activated: 1 });
				logger.info(`${trade.symbol} 트레일링 스탑 활성화`, { pnl_pct: pnlPct.toFixed(2) });
			}

			if (isActivated && risk.shouldTriggerProgressiveTrailing(pnlPct, newPeak)) {
				const trailPct = risk.getProgressiveTrailPct(newPeak);
				exitReason = "trailing_stop";
				logger.info(`${trade.symbol} 프로그레시브 트레일링 트리거`, {
					peak: newPeak.toFixed(2),
					current: pnlPct.toFixed(2),
					trail_pct: trailPct.toFixed(2),
				});
			}
		}

		if (exitReason) {
			// 청산 실행
			if (!isPaperMode()) {
				try {
					const isBuy = trade.side === "SHORT";
					await safeApiCall(() =>
						hl.placeMarketOrder({
							coin: trade.symbol,
							isBuy,
							size: trade.size,
							reduceOnly: true,
						})
					);
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					logger.error(`${trade.symbol} 청산 실패`, { error: msg });
					details.push({ symbol: trade.symbol, action: "close_failed", error: msg });
					continue;
				}
			}

			// 수수료 및 DB 업데이트
			const exitFeeRate = loadConfig().trade_agent.paper_fee_rate || 0.0005;
			const exitFees = currentPrice * trade.size * exitFeeRate;
			const totalFees = (trade.fees || 0) + exitFees;

			updateTrade(trade.trade_id, {
				status: "closed",
				timestamp_close: new Date().toISOString(),
				exit_price: currentPrice,
				pnl: parseFloat((pnl - totalFees).toFixed(4)),
				pnl_pct: parseFloat(pnlPct.toFixed(4)),
				fees: parseFloat(totalFees.toFixed(4)),
				exit_reason: exitReason as ExitReason,
			});

			closedCount++;
			logger.info(`${trade.symbol} 청산 [${exitReason}]`, {
				pnl: (pnl - totalFees).toFixed(4),
				pnl_pct: `${pnlPct.toFixed(2)}%`,
			});

			details.push({
				symbol: trade.symbol,
				action: "closed",
				exit_reason: exitReason,
				pnl: parseFloat((pnl - totalFees).toFixed(4)),
				pnl_pct: `${pnlPct.toFixed(2)}%`,
			});
		} else {
			details.push({
				symbol: trade.symbol,
				action: "holding",
				price: currentPrice,
				pnl_pct: `${pnlPct.toFixed(2)}%`,
				sl: stopLoss.toFixed(2),
				tp: takeProfit.toFixed(2),
				trailing: trade.trailing_activated === 1,
			});
		}
	}

	return { positions: openTrades.length, closed: closedCount, details };
}

// ─── 메인 ───

async function main() {
	const { once, interval } = parseArgs();
	const config = loadConfig();
	const privateKey = process.env.HYPERLIQUID_PRIVATE_KEY || config.trade_agent?.hyperliquid?.private_key;

	// HyperLiquid 서비스 초기화
	const hl = new HyperliquidService();
	if (privateKey && privateKey.length > 10) {
		await hl.initWallet(privateKey);
	}

	// RiskManager 초기화 (전략 프리셋 적용)
	const strategyName = getStrategy();
	const preset = getStrategyPreset(strategyName);
	const risk = new RiskManager(preset.trade);

	logger.info("포지션 모니터 시작", { interval: `${interval}s`, mode: once ? "once" : "continuous", strategy: strategyName });

	if (once) {
		const result = await checkPositions(hl, risk, preset.trade);
		console.log(JSON.stringify({ status: "success", ...result }, null, 2));
		closeDb();
		return;
	}

	// 상태 초기화
	const status: MonitorStatus = {
		state: "running",
		pid: process.pid,
		startedAt: new Date().toISOString(),
		checkCount: 0,
		closedCount: 0,
		openPositions: 0,
		lastCheckAt: null,
		intervalSec: interval,
		updatedAt: new Date().toISOString(),
	};
	writeStatus(status);

	// Graceful shutdown
	const shutdown = (signal: string) => {
		logger.info(`모니터 종료 (${signal})`);
		status.state = "stopped";
		status.updatedAt = new Date().toISOString();
		writeStatus(status);
		closeDb();
		process.exit(0);
	};
	process.on("SIGINT", () => shutdown("SIGINT"));
	process.on("SIGTERM", () => shutdown("SIGTERM"));

	let idleCycles = 0;

	while (true) {
		// 제어 명령 확인
		const cmd = readControl();
		if (cmd === "stop") {
			logger.info("정지 명령 수신");
			shutdown("dashboard stop");
		}

		try {
			const result = await checkPositions(hl, risk, preset.trade);
			status.checkCount++;
			status.closedCount += result.closed;
			status.openPositions = result.positions - result.closed;
			status.lastCheckAt = new Date().toISOString();
			status.updatedAt = new Date().toISOString();
			writeStatus(status);

			// 포지션 상태 로그
			if (result.positions > 0) {
				idleCycles = 0;
				const holdingCount = result.details.filter((d: any) => d.action === "holding").length;
				const closedStr = result.closed > 0 ? ` | 청산: ${result.closed}건` : "";
				logger.info(`체크 #${status.checkCount} | 포지션: ${result.positions}건 (holding: ${holdingCount})${closedStr}`);

				// 모든 포지션이 청산되었으면 곧 종료
				if (status.openPositions === 0) {
					logger.info("모든 포지션 청산 완료 — 모니터 유지 (새 포지션 대기)");
					idleCycles++;
				}
			} else {
				idleCycles++;
				if (idleCycles % 10 === 1) {
					logger.info(`대기 중... (열린 포지션 없음, ${idleCycles}/${IDLE_EXIT_CYCLES} 사이클)`);
				}
			}

			// 포지션 없이 오래 지속되면 자동 종료
			if (idleCycles >= IDLE_EXIT_CYCLES) {
				logger.info(`포지션 없이 ${IDLE_EXIT_CYCLES} 사이클 경과 — 자동 종료`);
				shutdown("idle_timeout");
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logger.error(`모니터 에러: ${msg}`);
		}

		await new Promise((r) => setTimeout(r, interval * 1000));
	}
}

main().catch((err) => {
	logger.error("모니터 치명적 에러", { error: err instanceof Error ? err.message : String(err) });
	closeDb();
	process.exit(1);
});
