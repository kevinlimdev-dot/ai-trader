import { Database } from 'bun:sqlite';
import { resolve } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { parse, stringify } from 'yaml';

const PROJECT_ROOT = resolve(process.cwd(), '..');
const DB_PATH = resolve(PROJECT_ROOT, 'data', 'ai-trader.db');

let db: Database | null = null;

function getDb(): Database {
	if (!db) {
		db = new Database(DB_PATH, { readonly: true });
		db.exec('PRAGMA journal_mode=WAL');
	}
	return db;
}

export function getConfig(): Record<string, unknown> {
	const configPath = resolve(PROJECT_ROOT, 'config.yaml');
	if (!existsSync(configPath)) return {};
	return parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
}

export function getMode(): string {
	const config = getConfig() as { general?: { mode?: string } };
	return config?.general?.mode || 'paper';
}

export function isKillSwitchActive(): boolean {
	const config = getConfig() as { trade_agent?: { safety?: { kill_switch_file?: string } } };
	const ksFile = config?.trade_agent?.safety?.kill_switch_file || 'data/KILL_SWITCH';
	return existsSync(resolve(PROJECT_ROOT, ksFile));
}

// ─── Dashboard KPI ───

export function getDashboardData() {
	const d = getDb();
	const today = new Date().toISOString().split('T')[0];

	const todayTrades = d.query(`SELECT * FROM trades WHERE date(timestamp_open) = ?`).all(today) as any[];
	const openTrades = d.query(`SELECT * FROM trades WHERE status IN ('open', 'paper')`).all() as any[];
	const latestBalance = d.query(`SELECT * FROM balance_snapshots ORDER BY id DESC LIMIT 1`).get() as any | null;
	const todayPnl = todayTrades.filter((t: any) => t.pnl !== null).reduce((sum: number, t: any) => sum + (t.pnl || 0), 0);
	const todayFees = todayTrades.filter((t: any) => t.fees !== null).reduce((sum: number, t: any) => sum + (t.fees || 0), 0);
	const closedToday = todayTrades.filter((t: any) => t.status === 'closed');
	const wins = closedToday.filter((t: any) => t.pnl > 0).length;
	const winRate = closedToday.length > 0 ? (wins / closedToday.length) * 100 : 0;

	const recentTrades = d.query(`SELECT * FROM trades ORDER BY id DESC LIMIT 10`).all() as any[];

	return {
		mode: getMode(),
		killSwitch: isKillSwitchActive(),
		todayPnl,
		todayFees,
		todayTradeCount: todayTrades.length,
		winRate: Math.round(winRate * 10) / 10,
		openPositionCount: openTrades.length,
		openPositions: openTrades,
		balance: latestBalance ? {
			coinbase: latestBalance.coinbase_balance as number,
			hyperliquid: latestBalance.hyperliquid_balance as number,
			total: latestBalance.total_balance as number,
		} : null,
		recentTrades,
	};
}

// ─── Trades ───

export function getTrades(opts: { page: number; limit: number; symbol?: string; side?: string; status?: string }) {
	const d = getDb();
	const conditions: string[] = [];
	const params: (string | number)[] = [];

	if (opts.symbol) { conditions.push('symbol = ?'); params.push(opts.symbol); }
	if (opts.side) { conditions.push('side = ?'); params.push(opts.side); }
	if (opts.status) { conditions.push('status = ?'); params.push(opts.status); }

	const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
	const countResult = d.query(`SELECT COUNT(*) as cnt FROM trades ${where}`).get(...params) as { cnt: number };
	const total = countResult.cnt;

	const offset = (opts.page - 1) * opts.limit;
	const allParams = [...params, opts.limit, offset];
	const rows = d.query(`SELECT * FROM trades ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...allParams) as any[];

	return { trades: rows, total, page: opts.page, limit: opts.limit, totalPages: Math.ceil(total / opts.limit) };
}

// ─── Positions ───

export function getOpenPositions() {
	const d = getDb();
	return d.query(`SELECT * FROM trades WHERE status IN ('open', 'paper') ORDER BY id DESC`).all() as any[];
}

// ─── Signals ───

export function getLatestSignals() {
	const signalPath = resolve(PROJECT_ROOT, 'data', 'signals', 'latest.json');
	if (!existsSync(signalPath)) return null;
	try {
		return JSON.parse(readFileSync(signalPath, 'utf-8'));
	} catch { return null; }
}

export function getLatestSnapshots() {
	const snapshotPath = resolve(PROJECT_ROOT, 'data', 'snapshots', 'latest.json');
	if (!existsSync(snapshotPath)) return null;
	try {
		return JSON.parse(readFileSync(snapshotPath, 'utf-8'));
	} catch { return null; }
}

// ─── Wallet ───

export function getWalletData() {
	const d = getDb();
	const latestBalance = d.query(`SELECT * FROM balance_snapshots ORDER BY id DESC LIMIT 1`).get() as any | null;
	const transfers = d.query(`SELECT * FROM wallet_transfers ORDER BY id DESC LIMIT 20`).all() as any[];
	const balanceHistory = d.query(`SELECT * FROM balance_snapshots ORDER BY id DESC LIMIT 50`).all() as any[];

	return { balance: latestBalance, transfers, balanceHistory };
}

// ─── Snapshots for chart ───

export function getRecentSnapshotsFromDb(symbol: string, limit: number = 100) {
	const d = getDb();
	return d.query(`SELECT * FROM snapshots WHERE symbol = ? ORDER BY id DESC LIMIT ?`).all(symbol, limit) as any[];
}

// ─── Live Prices (latest snapshot per symbol) ───

export interface LivePrice {
	symbol: string;
	binance_price: number;
	hl_price: number;
	spread_pct: number;
	timestamp: string;
}

export function getLatestPrices(): LivePrice[] {
	const d = getDb();
	const config = getConfig() as { data_agent?: { symbols?: { symbol: string }[] } };
	const symbols = config?.data_agent?.symbols?.map(s => s.symbol) || ['BTC', 'ETH'];

	const prices: LivePrice[] = [];
	for (const sym of symbols) {
		const row = d.query(`SELECT * FROM snapshots WHERE symbol = ? ORDER BY id DESC LIMIT 1`).get(sym) as any | null;
		if (row) {
			prices.push({
				symbol: sym,
				binance_price: row.binance_mark_price ?? 0,
				hl_price: row.hl_mid_price ?? 0,
				spread_pct: row.spread_percentage ?? 0,
				timestamp: row.timestamp ?? '',
			});
		}
	}
	return prices;
}

// ─── Price change (recent 2 snapshots) ───

export interface PriceWithChange extends LivePrice {
	binance_change_pct: number;
	hl_change_pct: number;
}

export function getLatestPricesWithChange(): PriceWithChange[] {
	const d = getDb();
	const config = getConfig() as { data_agent?: { symbols?: { symbol: string }[] } };
	const symbols = config?.data_agent?.symbols?.map(s => s.symbol) || ['BTC', 'ETH'];

	const prices: PriceWithChange[] = [];
	for (const sym of symbols) {
		const rows = d.query(`SELECT * FROM snapshots WHERE symbol = ? ORDER BY id DESC LIMIT 2`).all(sym) as any[];
		if (rows.length > 0) {
			const latest = rows[0];
			const prev = rows.length > 1 ? rows[1] : null;

			const bPrice = latest.binance_mark_price ?? 0;
			const hPrice = latest.hl_mid_price ?? 0;
			const prevB = prev?.binance_mark_price ?? bPrice;
			const prevH = prev?.hl_mid_price ?? hPrice;

			prices.push({
				symbol: sym,
				binance_price: bPrice,
				hl_price: hPrice,
				spread_pct: latest.spread_percentage ?? 0,
				timestamp: latest.timestamp ?? '',
				binance_change_pct: prevB > 0 ? ((bPrice - prevB) / prevB) * 100 : 0,
				hl_change_pct: prevH > 0 ? ((hPrice - prevH) / prevH) * 100 : 0,
			});
		}
	}
	return prices;
}

// ─── Awal 캐시 파일 읽기 (사이드카 프로세스가 갱신) ───

const AWAL_CACHE_FILE = '/tmp/ai-trader-awal-cache.json';

interface AwalCache {
	status: 'ok' | 'error' | 'unknown';
	balance: number;
	address: string | null;
	updatedAt: string | null;
	error: string | null;
}

function readAwalCache(): AwalCache {
	try {
		if (!existsSync(AWAL_CACHE_FILE)) {
			return { status: 'unknown', balance: 0, address: null, updatedAt: null, error: 'sidecar not running' };
		}
		const raw = readFileSync(AWAL_CACHE_FILE, 'utf-8');
		const data = JSON.parse(raw);

		// 캐시가 60초 이상 오래되었으면 stale 처리
		if (data.updatedAt) {
			const age = Date.now() - new Date(data.updatedAt).getTime();
			if (age > 60_000) {
				return { ...data, status: 'unknown', error: 'cache stale (sidecar may have stopped)' };
			}
		}

		return data;
	} catch {
		return { status: 'unknown', balance: 0, address: null, updatedAt: null, error: 'cache read error' };
	}
}

// awalCache를 직접 참조하는 곳을 위한 getter
function getAwalCache(): AwalCache {
	return readAwalCache();
}

// ─── Live Balances (실시간 잔고 조회) ───

interface LiveBalance {
	coinbase: number;
	hyperliquid: number;
	total: number;
	timestamp: string;
	hlDetail?: HlBalanceDetail;
}

let cachedLiveBalance: (LiveBalance & { hlDetail?: HlBalanceDetail }) | null = null;
let liveBalanceFetchedAt = 0;
const LIVE_BALANCE_CACHE_TTL = 15_000; // 15초 캐시

interface HlBalanceDetail {
	perp: number;
	spot: { coin: string; total: string; hold: string; usdValue: number }[];
	spotTotalUsd: number;
	totalUsd: number;
}

async function fetchHlBalance(): Promise<HlBalanceDetail> {
	const empty: HlBalanceDetail = { perp: 0, spot: [], spotTotalUsd: 0, totalUsd: 0 };
	try {
		const envPath = resolve(PROJECT_ROOT, '.env');
		if (!existsSync(envPath)) return empty;

		const envContent = readFileSync(envPath, 'utf-8');
		let privateKey = '';
		for (const line of envContent.split('\n')) {
			const trimmed = line.trim();
			if (trimmed.startsWith('HYPERLIQUID_PRIVATE_KEY=')) {
				privateKey = trimmed.slice('HYPERLIQUID_PRIVATE_KEY='.length).trim();
			}
		}

		if (!privateKey || privateKey === '0xyour_private_key' || privateKey.length < 10) return empty;

		const { privateKeyToAccount } = await import('viem/accounts');
		const formattedKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
		const account = privateKeyToAccount(formattedKey as `0x${string}`);

		const { HttpTransport, InfoClient } = await import('@nktkas/hyperliquid');
		const configData = getConfig() as { trade_agent?: { hyperliquid?: { base_url?: string } } };
		const baseUrl = configData?.trade_agent?.hyperliquid?.base_url || 'https://api.hyperliquid.xyz';

		const transport = new HttpTransport({ apiUrl: baseUrl });
		const infoClient = new InfoClient({ transport });

		const timeout = <T>(p: Promise<T>, ms: number, label: string) =>
			Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${label} timeout`)), ms))]);

		// 선물 마진 + 스팟 잔고 + 스팟 가격 병렬 조회
		const [perpResult, spotResult, spotMeta] = await Promise.all([
			timeout(infoClient.clearinghouseState({ user: account.address }), 10_000, 'perp').catch(() => null),
			timeout(infoClient.spotClearinghouseState({ user: account.address }), 10_000, 'spot').catch(() => null),
			timeout(infoClient.spotMeta(), 10_000, 'spotMeta').catch(() => null),
		]);

		// 1. 선물 마진 잔고
		const perpVal = perpResult ? parseFloat((perpResult as any).marginSummary?.accountValue) || 0 : 0;

		// 2. 스팟 잔고
		const spotBalances: HlBalanceDetail['spot'] = [];
		let spotTotalUsd = 0;

		if (spotResult && (spotResult as any).balances) {
			// 스팟 토큰 index → mid price 매핑 (allMids 사용)
			let midPrices: Record<string, number> = {};
			try {
				const mids = await timeout(infoClient.allMids(), 5_000, 'allMids');
				if (mids && typeof mids === 'object') {
					for (const [sym, price] of Object.entries(mids as Record<string, string>)) {
						midPrices[sym] = parseFloat(price) || 0;
					}
				}
			} catch { /* 가격 조회 실패 시 entryNtl 사용 */ }

			// 스팟 메타에서 token index → name 매핑
			const tokenNameMap: Record<number, string> = {};
			if (spotMeta && (spotMeta as any).tokens) {
				for (const t of (spotMeta as any).tokens) {
					tokenNameMap[t.index] = t.name;
				}
			}

			for (const b of (spotResult as any).balances) {
				const total = parseFloat(b.total) || 0;
				if (total <= 0) continue;

				const coin: string = b.coin;
				let usdValue = 0;

				if (coin === 'USDC' || coin === 'USDT') {
					usdValue = total;
				} else {
					// mid price로 USD 환산
					const priceKey = coin; // allMids에서의 키
					if (midPrices[priceKey] && midPrices[priceKey] > 0) {
						usdValue = total * midPrices[priceKey];
					} else {
						// fallback: entryNtl 사용
						usdValue = parseFloat(b.entryNtl) || 0;
					}
				}

				spotBalances.push({ coin, total: b.total, hold: b.hold, usdValue });
				spotTotalUsd += usdValue;
			}
		}

		const totalUsd = perpVal + spotTotalUsd;
		console.log(`[HL Balance] ${account.address} -> perp: $${perpVal.toFixed(2)}, spot: $${spotTotalUsd.toFixed(2)} (${spotBalances.map(s => `${s.coin}: ${s.total}`).join(', ')}), total: $${totalUsd.toFixed(2)}`);

		return { perp: perpVal, spot: spotBalances, spotTotalUsd, totalUsd };
	} catch (err) {
		console.error('[HL Balance error]', err instanceof Error ? err.message : err);
		return empty;
	}
}

export async function getLiveBalances(): Promise<LiveBalance & { hlDetail?: HlBalanceDetail }> {
	const now = Date.now();
	if (cachedLiveBalance && (now - liveBalanceFetchedAt) < LIVE_BALANCE_CACHE_TTL) {
		return cachedLiveBalance;
	}

	const hlDetail = await fetchHlBalance();
	const awalData = readAwalCache();
	const cb = awalData.balance;

	cachedLiveBalance = {
		coinbase: cb,
		hyperliquid: hlDetail.totalUsd,
		total: cb + hlDetail.totalUsd,
		timestamp: new Date().toISOString(),
		hlDetail,
	};
	liveBalanceFetchedAt = now;

	return cachedLiveBalance;
}

// ─── Available Trading Coins (HyperLiquid meta) ───

interface TradableCoin {
	name: string;
	szDecimals: number;
	maxLeverage: number;
}

let cachedCoins: TradableCoin[] = [];
let coinsFetchedAt = 0;
const COINS_CACHE_TTL = 300_000; // 5분

export async function getAvailableCoins(): Promise<TradableCoin[]> {
	const now = Date.now();
	if (cachedCoins.length > 0 && (now - coinsFetchedAt) < COINS_CACHE_TTL) {
		return cachedCoins;
	}

	try {
		const { HttpTransport, InfoClient } = await import('@nktkas/hyperliquid');
		const configData = getConfig() as { trade_agent?: { hyperliquid?: { base_url?: string } } };
		const baseUrl = configData?.trade_agent?.hyperliquid?.base_url || 'https://api.hyperliquid.xyz';

		const transport = new HttpTransport({ apiUrl: baseUrl });
		const infoClient = new InfoClient({ transport });
		const meta = await infoClient.meta() as { universe: TradableCoin[] };

		cachedCoins = meta.universe
			.filter((c: any) => !c.name.startsWith('@') && !c.isDelisted)
			.sort((a, b) => a.name.localeCompare(b.name));
		coinsFetchedAt = now;

		return cachedCoins;
	} catch (err) {
		console.error('[Available Coins]', err instanceof Error ? err.message : err);
		return cachedCoins;
	}
}

// ─── Config Symbols ───

export function getConfigSymbols(): string[] {
	const config = getConfig() as { data_agent?: { symbols?: { symbol: string }[] } };
	return config?.data_agent?.symbols?.map(s => s.symbol) || [];
}

// ─── API Error Count ───

export function getApiErrorCount(): number {
	const d = getDb();
	const row = d.query(`SELECT value FROM api_state WHERE key = 'consecutive_api_errors'`).get() as { value: string } | null;
	return row ? parseInt(row.value, 10) : 0;
}

// ─── Mode Switch ───

export function setMode(newMode: 'paper' | 'live'): { success: boolean; mode: string; error?: string } {
	const configPath = resolve(PROJECT_ROOT, 'config.yaml');
	if (!existsSync(configPath)) {
		return { success: false, mode: 'paper', error: 'config.yaml not found' };
	}

	try {
		const raw = readFileSync(configPath, 'utf-8');
		const config = parse(raw) as any;
		config.general = config.general || {};
		config.general.mode = newMode;
		writeFileSync(configPath, stringify(config, { lineWidth: 120 }));
		return { success: true, mode: newMode };
	} catch (e) {
		return { success: false, mode: getMode(), error: e instanceof Error ? e.message : String(e) };
	}
}

// ─── Setup Validation ───

export interface SetupCheck {
	id: string;
	label: string;
	status: 'ok' | 'warning' | 'error';
	message: string;
	required: boolean; // true = must fix, false = optional
}

export function validateSetup(): SetupCheck[] {
	const checks: SetupCheck[] = [];

	// 1. config.yaml
	const configPath = resolve(PROJECT_ROOT, 'config.yaml');
	if (!existsSync(configPath)) {
		checks.push({ id: 'config', label: 'config.yaml', status: 'error', message: 'config.yaml file not found', required: true });
	} else {
		checks.push({ id: 'config', label: 'config.yaml', status: 'ok', message: 'Configuration file exists', required: true });
	}

	// 2. .env file
	const envPath = resolve(PROJECT_ROOT, '.env');
	if (!existsSync(envPath)) {
		checks.push({ id: 'env', label: '.env file', status: 'error', message: '.env file not found — copy .env.example to .env', required: true });
	} else {
		checks.push({ id: 'env', label: '.env file', status: 'ok', message: '.env file exists', required: true });
	}

	// 3. Read .env values
	let envVars: Record<string, string> = {};
	if (existsSync(envPath)) {
		const envContent = readFileSync(envPath, 'utf-8');
		for (const line of envContent.split('\n')) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#')) continue;
			const eqIdx = trimmed.indexOf('=');
			if (eqIdx > 0) {
				const key = trimmed.slice(0, eqIdx).trim();
				const val = trimmed.slice(eqIdx + 1).trim();
				envVars[key] = val;
			}
		}
	}

	// 4. HyperLiquid Private Key
	const hlKey = envVars['HYPERLIQUID_PRIVATE_KEY'] || '';
	if (!hlKey || hlKey === '0xyour_private_key' || hlKey.length < 10) {
		checks.push({ id: 'hl_key', label: 'HyperLiquid Private Key', status: 'error', message: 'HYPERLIQUID_PRIVATE_KEY not set in .env — required for live trading', required: true });
	} else {
		checks.push({ id: 'hl_key', label: 'HyperLiquid Private Key', status: 'ok', message: 'Private key configured', required: true });
	}

	// 5. HyperLiquid Deposit Address
	const hlAddr = envVars['HYPERLIQUID_DEPOSIT_ADDRESS'] || '';
	if (!hlAddr || hlAddr === '0xyour_deposit_address' || hlAddr.length < 10) {
		checks.push({ id: 'hl_addr', label: 'HyperLiquid Deposit Address', status: 'warning', message: 'HYPERLIQUID_DEPOSIT_ADDRESS not set — needed for fund transfers', required: false });
	} else {
		checks.push({ id: 'hl_addr', label: 'HyperLiquid Deposit Address', status: 'ok', message: 'Deposit address configured', required: false });
	}

	// 6. Database
	if (!existsSync(DB_PATH)) {
		checks.push({ id: 'db', label: 'Database', status: 'error', message: 'Database file not found — run: bun run setup-db', required: true });
	} else {
		checks.push({ id: 'db', label: 'Database', status: 'ok', message: 'Database exists', required: true });
	}

	// 7. Coinbase Agentic Wallet (optional but recommended)
	// awal 인증 상태는 사이드카 캐시 파일에서 읽기
	const awal = getAwalCache();
	if (awal.status === 'ok') {
		checks.push({ id: 'awal', label: 'Coinbase Agentic Wallet', status: 'ok', message: `Wallet authenticated${awal.address ? ` (${awal.address.slice(0, 8)}...)` : ''}`, required: false });
	} else if (awal.status === 'error') {
		checks.push({ id: 'awal', label: 'Coinbase Agentic Wallet', status: 'warning', message: 'Wallet not authenticated — run: bunx awal auth login <email>', required: false });
	} else {
		checks.push({ id: 'awal', label: 'Coinbase Agentic Wallet', status: 'warning', message: awal.error || 'Checking wallet status... (ensure awal sidecar is running)', required: false });
	}

	// 8. Check if mode is live but key looks like placeholder
	const mode = getMode();
	if (mode === 'live') {
		if (!hlKey || hlKey === '0xyour_private_key' || hlKey.length < 10) {
			checks.push({ id: 'live_danger', label: 'LIVE MODE WITHOUT KEYS', status: 'error', message: 'Live mode is active but HyperLiquid private key is not configured!', required: true });
		}
	}

	return checks;
}

export function getSetupSummary(): { ok: boolean; errors: number; warnings: number; checks: SetupCheck[] } {
	const checks = validateSetup();
	const errors = checks.filter(c => c.status === 'error').length;
	const warnings = checks.filter(c => c.status === 'warning').length;
	return { ok: errors === 0, errors, warnings, checks };
}

// ─── Wallet Addresses ───

export interface WalletAddresses {
	hyperliquid: {
		address: string;
		network: string;
		note: string;
	} | null;
	coinbase: {
		address?: string;
		network: string;
		note: string;
	};
}

export async function getWalletAddresses(): Promise<WalletAddresses> {
	// Read HL address from .env
	const envPath = resolve(PROJECT_ROOT, '.env');
	let hlAddr = '';
	if (existsSync(envPath)) {
		const envContent = readFileSync(envPath, 'utf-8');
		for (const line of envContent.split('\n')) {
			const trimmed = line.trim();
			if (trimmed.startsWith('HYPERLIQUID_DEPOSIT_ADDRESS=')) {
				hlAddr = trimmed.slice('HYPERLIQUID_DEPOSIT_ADDRESS='.length).trim();
			}
		}
	}

	const validHl = hlAddr && hlAddr !== '0xyour_deposit_address' && hlAddr.length > 10;

	// Coinbase 주소: 사이드카 캐시 파일에서 읽기
	const awalData = readAwalCache();
	const cbAddr = awalData.address;

	return {
		hyperliquid: validHl ? {
			address: hlAddr,
			network: 'Arbitrum One',
			note: 'HyperLiquid 거래용 (봇이 자동으로 자금 배분)',
		} : null,
		coinbase: {
			address: cbAddr ?? undefined,
			network: 'Base',
			note: cbAddr
				? '이 주소로 USDC를 입금하세요. 봇이 자동으로 HyperLiquid에 배분합니다.'
				: 'bunx awal address 로 주소 확인 후 입금',
		},
	};
}
