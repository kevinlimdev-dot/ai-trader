export interface DashboardData {
	mode: string;
	killSwitch: boolean;
	todayPnl: number;
	todayFees: number;
	todayTradeCount: number;
	winRate: number;
	openPositionCount: number;
	openPositions: TradeRow[];
	balance: { coinbase: number; hyperliquid: number; total: number } | null;
	recentTrades: TradeRow[];
}

export interface TradeRow {
	id: number;
	trade_id: string;
	timestamp_open: string;
	timestamp_close?: string;
	symbol: string;
	side: string;
	entry_price: number;
	exit_price?: number;
	size: number;
	leverage: number;
	stop_loss?: number;
	take_profit?: number;
	peak_pnl_pct?: number;
	trailing_activated?: number;
	pnl?: number;
	pnl_pct?: number;
	fees?: number;
	exit_reason?: string;
	signal_confidence?: number;
	status: string;
	created_at?: string;
}

export interface TradesResponse {
	trades: TradeRow[];
	total: number;
	page: number;
	limit: number;
	totalPages: number;
}

export interface SignalData {
	generated_at: string;
	signals: {
		timestamp: string;
		symbol: string;
		action: string;
		confidence: number;
		entry_price: number;
		stop_loss: number;
		take_profit: number;
		analysis: {
			spread: { value_pct: number; direction: string; signal: string };
			rsi: { value: number; signal: string };
			macd: { histogram: number; macd_line: number; signal_line: number; signal: string };
			bollinger: { upper: number; middle: number; lower: number; position: string; signal: string };
			ma: { ma_7: number; ma_25: number; ma_99: number; signal: string };
			composite_score: number;
		};
		risk: { risk_reward_ratio: number; max_position_pct: number; atr: number };
	}[];
}

export interface WalletData {
	balance: {
		coinbase_balance: number;
		hyperliquid_balance: number;
		total_balance: number;
		timestamp: string;
	} | null;
	transfers: {
		id: number;
		transfer_id: string;
		timestamp: string;
		direction: string;
		amount: number;
		currency: string;
		status: string;
		tx_hash?: string;
	}[];
	balanceHistory: {
		timestamp: string;
		coinbase_balance: number;
		hyperliquid_balance: number;
		total_balance: number;
	}[];
}

export interface BotResult {
	success: boolean;
	data?: unknown;
	error?: string;
	raw?: string;
}

export interface SetupCheck {
	id: string;
	label: string;
	status: 'ok' | 'warning' | 'error';
	message: string;
	required: boolean;
}

export interface SetupSummary {
	ok: boolean;
	errors: number;
	warnings: number;
	checks: SetupCheck[];
}

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

export interface LivePrice {
	symbol: string;
	binance_price: number;
	hl_price: number;
	spread_pct: number;
	timestamp: string;
	binance_change_pct: number;
	hl_change_pct: number;
}
