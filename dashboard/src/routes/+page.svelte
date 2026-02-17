<script lang="ts">
	import KpiCard from '$lib/components/KpiCard.svelte';
	import TradesTable from '$lib/components/TradesTable.svelte';
	import SignalBadge from '$lib/components/SignalBadge.svelte';
	import PriceChart from '$lib/components/PriceChart.svelte';
	import type { DashboardData, BotResult, LivePrice, WalletAddresses } from '$lib/types';

	interface TradableCoin {
		name: string;
		szDecimals: number;
		maxLeverage: number;
	}

	interface HlSpotBalance {
		coin: string;
		total: string;
		hold: string;
		usdValue: number;
	}

	interface HlBalanceDetail {
		perp: number;
		spot: HlSpotBalance[];
		spotTotalUsd: number;
		totalUsd: number;
	}

	interface LiveBalance {
		coinbase: number;
		hyperliquid: number;
		total: number;
		timestamp: string;
		hlDetail?: HlBalanceDetail;
	}

	// HL 실시간 포지션 타입
	interface HlLivePosition {
		coin: string;
		side: 'LONG' | 'SHORT';
		size: number;
		entryPx: number;
		positionValue: number;
		unrealizedPnl: number;
		leverage: number;
		leverageType: string;
		liquidationPx: number | null;
		marginUsed: number;
		returnOnEquity: number;
	}

	let { data } = $props();
	let dashboard: DashboardData = $state(data.dashboard as any);
	let signals: any = $state(data.signals);
	let livePrices: LivePrice[] = $state(data.livePrices as any ?? []);
	let walletAddresses: WalletAddresses = $state(data.walletAddresses as any);
	let liveBalances: LiveBalance | null = $state(data.liveBalances as any ?? null);
	let availableCoins: TradableCoin[] = $state(data.availableCoins as any ?? []);
	let configSymbols: string[] = $state(data.configSymbols as any ?? []);
	let hlPositions: HlLivePosition[] = $state(data.hlPositions as any ?? []);
	let chartData: Record<string, { time: string; binance: number; hyperliquid: number }[]> = $state({});
	let chartSymbol = $state('BTC');
	let lastPriceUpdate = $state(Date.now());
	let copiedId = $state('');
	let showAllCoins = $state(false);

	// Deposit state (Arbitrum → HyperLiquid)
	interface DepositInfo {
		status: string;
		amount?: string;
		usdcBalance?: string;
		ethBalance?: string;
		txHash?: string;
		arbiscan?: string;
		error?: string;
	}
	let depositLoading = $state(false);
	let depositResult: DepositInfo | null = $state(null);
	let depositChecking = $state(false);
	let arbUsdcBalance: string | null = $state(null);

	async function checkArbBalance() {
		depositChecking = true;
		try {
			const res = await fetch('/api/bot/deposit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'check' }) });
			const data = await res.json();
			if (data.status === 'dry_run') {
				arbUsdcBalance = data.usdcBalance || data.amount || null;
			}
		} catch { /* ignore */ }
		depositChecking = false;
	}

	async function executeDeposit() {
		if (!confirm('Arbitrum USDC를 HyperLiquid에 입금합니다. 진행하시겠습니까?')) return;
		depositLoading = true;
		depositResult = null;
		try {
			const res = await fetch('/api/bot/deposit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'deposit' }) });
			depositResult = await res.json();
			if (depositResult?.status === 'success') {
				// 입금 성공 후 잔고 갱신 (HyperLiquid 입금 처리 ~1분)
				const refreshBal = async () => { try { liveBalances = await (await fetch('/api/balances')).json(); } catch {} };
				setTimeout(refreshBal, 5000);
				setTimeout(refreshBal, 30000);
				setTimeout(refreshBal, 60000);
				arbUsdcBalance = null;
			}
		} catch (err) {
			depositResult = { status: 'error', error: err instanceof Error ? err.message : String(err) };
		}
		depositLoading = false;
	}

	// Pipeline state (OpenClaw)
	type PipelineStep = { id: string; label: string; status: 'pending' | 'running' | 'done' | 'failed'; result?: BotResult };
	let pipelineRunning = $state(false);
	let pipelineSteps: PipelineStep[] = $state([]);
	let pipelineExpanded = $state(false);

	// OpenClaw state
	interface OpenClawState {
		state: 'idle' | 'running' | 'done' | 'failed';
		output: string;
		pid?: number;
		action?: string;
		startedAt?: string;
		completedAt?: string;
	}
	let openclawState: OpenClawState = $state({ state: 'idle', output: '' });
	let openclawPolling: ReturnType<typeof setInterval> | null = $state(null);

	// OpenClaw 연결 상태
	interface OpenClawConnection {
		installed: boolean;
		path: string | null;
		daemonRunning: boolean;
	}
	let openclawConn: OpenClawConnection = $state({ installed: false, path: null, daemonRunning: false });
	let openclawReady = $derived(openclawConn.installed && openclawConn.daemonRunning);

	// Runner state (continuous loop)
	interface RunnerStatus {
		state: 'running' | 'idle' | 'stopped' | 'error';
		pid: number;
		cycleCount: number;
		successCount: number;
		failCount: number;
		lastCycle: {
			startedAt: string;
			completedAt: string;
			success: boolean;
			steps: Record<string, { success: boolean; durationMs: number; error?: string }>;
			durationMs: number;
		} | null;
		nextCycleAt: string | null;
		intervalSec: number;
		mode: string;
		updatedAt: string | null;
		startedAt?: string;
		stoppedAt?: string;
		stopReason?: string;
	}

	let runnerStatus: RunnerStatus = $state({ state: 'stopped', pid: 0, cycleCount: 0, successCount: 0, failCount: 0, lastCycle: null, nextCycleAt: null, intervalSec: 0, mode: 'unknown', updatedAt: null });
	let runnerLoading = $state(false);

	// Position Monitor state
	interface MonitorStatus {
		state: 'running' | 'idle' | 'stopped';
		checkCount: number;
		closedCount: number;
		openPositions: number;
		lastCheckAt: string | null;
		intervalSec: number;
	}
	let monitorStatus: MonitorStatus = $state({ state: 'stopped', checkCount: 0, closedCount: 0, openPositions: 0, lastCheckAt: null, intervalSec: 15 });

	async function fetchMonitorStatus() {
		try {
			const res = await fetch('/api/bot/monitor');
			if (res.ok) monitorStatus = await res.json();
		} catch {}
	}

	async function toggleMonitor() {
		const action = monitorStatus.state === 'running' ? 'stop' : 'start';
		await fetch('/api/bot/monitor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
		setTimeout(fetchMonitorStatus, 1500);
	}

	// 개별 포지션 청산
	let closingPositions: Set<string> = $state(new Set());

	async function closePositionAction(coin: string, side: string) {
		const key = `${coin}-${side}`;
		if (closingPositions.has(key)) return;
		if (!confirm(`${coin} ${side} 포지션을 청산하시겠습니까?`)) return;

		closingPositions = new Set([...closingPositions, key]);
		try {
			const res = await fetch('/api/bot/close-position', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ coin, side })
			});
			const result = await res.json();
			if (!result.success) {
				alert(`청산 실패: ${result.error || '알 수 없는 오류'}`);
			}
			// 잠시 후 포지션/잔고 갱신
			setTimeout(async () => {
				try {
					const [posRes, balRes] = await Promise.all([
						fetch('/api/positions'),
						fetch('/api/balances'),
					]);
					if (posRes.ok) hlPositions = await posRes.json();
					if (balRes.ok) liveBalances = await balRes.json();
				} catch {}
			}, 2000);
		} catch (err) {
			alert(`청산 중 오류: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			const updated = new Set(closingPositions);
			updated.delete(key);
			closingPositions = updated;
		}
	}

	// Strategy state
	type StrategyName = 'conservative' | 'balanced' | 'aggressive';
	interface StrategyInfo {
		name: StrategyName;
		label: string;
		description: string;
		leverage: string;
		risk: string;
		rr: string;
		maxPos: number;
	}
	const STRATEGIES: StrategyInfo[] = [
		{ name: 'conservative', label: 'Conservative', description: '보수적 · 자본 보존', leverage: '5x', risk: '2%', rr: '1.5', maxPos: 5 },
		{ name: 'balanced', label: 'Balanced', description: '선별적 진입 · 안정 승률', leverage: '7x', risk: '3%', rr: '1.25', maxPos: 6 },
		{ name: 'aggressive', label: 'Aggressive', description: '공격적 · 모멘텀 추종', leverage: '10x', risk: '5%', rr: '4.0', maxPos: 15 },
	];
	let currentStrategy: StrategyName = $state('balanced');
	let strategyLoading = $state(false);
	let activeStrategy = $derived(STRATEGIES.find(s => s.name === currentStrategy) ?? STRATEGIES[1]);

	// Runner log state
	let runnerLog: string[] = $state([]);
	let signalExpanded: string | null = $state(null);
	let runnerActive = $derived(runnerStatus.state === 'running' || runnerStatus.state === 'idle');

	// AI Adjustments state
	interface AiAdjustment {
		timestamp: string;
		reason: string;
		adjustments: Record<string, { from: number; to: number }>;
		market_condition: string;
		action_taken: string;
	}
	let aiAdjustment: AiAdjustment | null = $state(null);

	async function fetchAiAdjustments() {
		try {
			const res = await fetch('/api/ai-adjustments');
			if (res.ok) aiAdjustment = await res.json();
		} catch {}
	}

	// 1초 tick — timeAgo를 실시간 갱신
	let tick = $state(0);

	function timeAgo(isoStr: string, _tick?: number): string {
		const diff = Date.now() - new Date(isoStr).getTime();
		const sec = Math.floor(diff / 1000);
		if (sec < 60) return `${sec}초 전`;
		const min = Math.floor(sec / 60);
		if (min < 60) return `${min}분 전`;
		const hr = Math.floor(min / 60);
		return `${hr}시간 ${min % 60}분 전`;
	}

	function formatPrice(price: number): string {
		if (price >= 1000) return price.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
		if (price >= 1) return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
		return price.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 6 });
	}

	function formatOpenClawOutput(raw: string): string {
		return raw
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/^(.*(?:LONG|매수|성공|완료|✅|✓).*)$/gm, '<span style="color:var(--accent-green)">$1</span>')
			.replace(/^(.*(?:SHORT|매도).*)$/gm, '<span style="color:var(--accent-yellow)">$1</span>')
			.replace(/^(.*(?:ERROR|error|실패|❌|⛔).*)$/gm, '<span style="color:var(--accent-red)">$1</span>')
			.replace(/^(.*(?:━━━|═══|───|시작|사이클).*)$/gm, '<span style="color:var(--accent-blue)">$1</span>')
			.replace(/^(.*(?:HOLD|스킵|NEUTRAL).*)$/gm, '<span style="opacity:0.5">$1</span>');
	}

	// ─── Tiered refresh intervals ───
	// Prices: every 3s (lightweight, DB-only)
	// Dashboard KPI + Signals + Runner: every 10s (moderate)
	// Charts: every 60s (heavier query)
	$effect(() => {
		// 1s tick for live countdowns
		const tickInterval = setInterval(() => { tick++; }, 1000);

		// Fast: Live prices every 3s
		const priceInterval = setInterval(async () => {
			try {
				const res = await fetch('/api/prices');
				const d = await res.json();
				livePrices = d.prices;
				lastPriceUpdate = d.ts;
			} catch { /* ignore */ }
		}, 3000);

		// Medium: Dashboard + signals + balances + runner + monitor + log every 10s
		fetchRunnerStatus();
		fetchStrategy();
		fetchRunnerLog();
		fetchOpenClawStatus();
		fetchMonitorStatus();
		const dashInterval = setInterval(async () => {
			try {
				const [dRes, sRes, bRes] = await Promise.all([
					fetch('/api/dashboard'),
					fetch('/api/signals'),
					fetch('/api/balances'),
				]);
				const dData = await dRes.json();
				dashboard = dData;
				if (dData.hlPositions) hlPositions = dData.hlPositions;
				const sData = await sRes.json();
				signals = sData.signals;
				liveBalances = await bRes.json();
			} catch { /* ignore */ }
			fetchRunnerStatus();
			fetchRunnerLog();
			fetchMonitorStatus();
			fetchAiAdjustments();
		}, 10000);

		// Slow: Charts + coins every 60s (heavier query)
		loadChartData();
		loadCoins();
		const chartInterval = setInterval(loadChartData, 60000);

		return () => {
			clearInterval(tickInterval);
			clearInterval(priceInterval);
			clearInterval(dashInterval);
			clearInterval(chartInterval);
			if (openclawPolling) clearInterval(openclawPolling);
		};
	});

	async function fetchRunnerStatus() {
		try {
			const res = await fetch('/api/bot/runner');
			runnerStatus = await res.json();
		} catch { /* ignore */ }
	}

	async function fetchOpenClawStatus() {
		try {
			const res = await fetch('/api/bot/openclaw');
			const d = await res.json();
			if (d.openclaw) openclawConn = d.openclaw;
		} catch { /* ignore */ }
	}

	async function fetchRunnerLog() {
		try {
			const res = await fetch('/api/bot/log?lines=30');
			const d = await res.json();
			if (d.lines) runnerLog = d.lines;
		} catch { /* ignore */ }
	}

	async function fetchStrategy() {
		try {
			const res = await fetch('/api/bot/strategy');
			const d = await res.json();
			if (d.strategy) currentStrategy = d.strategy;
		} catch { /* ignore */ }
	}

	async function setStrategy(name: StrategyName) {
		if (strategyLoading || name === currentStrategy) return;
		strategyLoading = true;
		try {
			const res = await fetch('/api/bot/strategy', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ strategy: name }),
			});
			const d = await res.json();
			if (d.success) currentStrategy = name;
		} catch { /* ignore */ }
		strategyLoading = false;
	}

	async function toggleRunner() {
		if (runnerLoading) return;
		runnerLoading = true;
		try {
			const isActive = runnerStatus.state === 'running' || runnerStatus.state === 'idle';
			const res = await fetch('/api/bot/runner', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: isActive ? 'stop' : 'start' }),
			});
			const data = await res.json();
			if (data.status) runnerStatus = data.status;
			// 상태 갱신을 위해 잠시 후 재조회
			setTimeout(fetchRunnerStatus, 2000);
		} catch { /* ignore */ }
		runnerLoading = false;
	}

	async function runnerRunNow() {
		if (runnerStatus.state !== 'idle') return;
		try {
			await fetch('/api/bot/runner', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'run-now' }),
			});
			setTimeout(fetchRunnerStatus, 2000);
		} catch { /* ignore */ }
	}

	function formatCountdown(targetIso: string | null): string {
		if (!targetIso) return '';
		const diff = Math.max(0, Math.floor((new Date(targetIso).getTime() - Date.now()) / 1000));
		if (diff <= 0) return 'now';
		const m = Math.floor(diff / 60);
		const s = diff % 60;
		return m > 0 ? `${m}분 ${s}초` : `${s}초`;
	}

	async function loadCoins() {
		try {
			const res = await fetch('/api/coins');
			const d = await res.json();
			availableCoins = d.coins;
		} catch { /* ignore */ }
	}

	async function loadChartData(symbol?: string) {
		const sym = symbol || chartSymbol;
		try {
			const res = await fetch(`/api/snapshots?symbol=${sym}&limit=100`);
			const json = await res.json();
			chartData = { ...chartData, [sym]: json.data };
		} catch { /* ignore */ }
	}

	function selectChartSymbol(symbol: string) {
		chartSymbol = symbol;
		if (!chartData[symbol] || chartData[symbol].length === 0) {
			loadChartData(symbol);
		}
	}

	async function runFullPipeline() {
		if (pipelineRunning) return;
		pipelineRunning = true;
		pipelineExpanded = true;
		pipelineSteps = [
			{ id: 'runner', label: '파이프라인 1회 실행', status: 'running' },
		];

		try {
			const res = await fetch('/api/bot/runner', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'once' }),
			});
			const result = await res.json();

			if (!result.success) {
				pipelineSteps[0].status = 'failed';
				pipelineSteps[0].result = { success: false, error: result.error };
				pipelineRunning = false;
				return;
			}

			// Runner 상태 + 로그를 폴링하여 진행 상황 추적
			const pollRunner = setInterval(async () => {
				await fetchRunnerStatus();
				await fetchRunnerLog();
				const st = runnerStatus;
				if (st.state === 'stopped' || st.state === 'error') {
					clearInterval(pollRunner);
					pipelineSteps[0].status = st.lastCycle?.success ? 'done' : 'failed';
					if (!st.lastCycle?.success) {
						pipelineSteps[0].result = { success: false, error: st.stopReason || 'Cycle failed' };
					}
					pipelineRunning = false;
					// 완료 후 데이터 갱신
					try {
						const [dRes, sRes] = await Promise.all([
							fetch('/api/dashboard'),
							fetch('/api/signals'),
						]);
						dashboard = await dRes.json();
						const sData = await sRes.json();
						signals = sData.signals;
						liveBalances = await (await fetch('/api/balances')).json();
					} catch { /* ignore */ }
				}
			}, 3000);
		} catch (e) {
			pipelineSteps[0].status = 'failed';
			pipelineSteps[0].result = { success: false, error: String(e) };
			pipelineRunning = false;
		}
	}

	async function pollOpenClaw() {
		try {
			const res = await fetch('/api/bot/openclaw');
			const data: OpenClawState = await res.json();
			openclawState = data;

			if (data.state === 'done') {
				pipelineSteps[0].status = 'done';
				pipelineRunning = false;
				if (openclawPolling) { clearInterval(openclawPolling); openclawPolling = null; }
				// 완료 후 대시보드 데이터 갱신
				try {
					const [dRes, sRes] = await Promise.all([
						fetch('/api/dashboard'),
						fetch('/api/signals'),
						fetch('/api/balances'),
					]);
					dashboard = await dRes.json();
					const sData = await sRes.json();
					signals = sData.signals;
					liveBalances = await (await fetch('/api/balances')).json();
				} catch { /* ignore */ }
				loadChartData();
			} else if (data.state === 'failed') {
				pipelineSteps[0].status = 'failed';
				pipelineSteps[0].result = { success: false, error: 'OpenClaw agent failed' };
				pipelineRunning = false;
				if (openclawPolling) { clearInterval(openclawPolling); openclawPolling = null; }
			}
		} catch { /* ignore */ }
	}

	async function copyAddress(addr: string, id: string) {
		try {
			await navigator.clipboard.writeText(addr);
			copiedId = id;
			setTimeout(() => { copiedId = ''; }, 2500);
		} catch { /* ignore */ }
	}

	function truncateAddr(addr: string) {
		if (addr.length <= 16) return addr;
		return `${addr.slice(0, 10)}...${addr.slice(-8)}`;
	}

	let pnlColor = $derived(dashboard.todayPnl >= 0 ? 'green' as const : 'red' as const);
	let pnlSign = $derived(dashboard.todayPnl >= 0 ? '+' : '');
	let pipelineDone = $derived(pipelineSteps.length > 0 && pipelineSteps.every(s => s.status === 'done' || s.status === 'failed'));
	let pipelineHasError = $derived(pipelineSteps.some(s => s.status === 'failed'));
</script>

<svelte:head><title>AI Trader - Dashboard</title></svelte:head>

<div class="space-y-5">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-bold">Dashboard</h1>
			<p class="text-sm text-[var(--text-secondary)]">Trading bot overview</p>
		</div>
		<div class="flex items-center gap-3">
			{#if dashboard.killSwitch}
				<span class="px-3 py-1 rounded-lg text-sm font-medium bg-[var(--accent-red)]/15 text-[var(--accent-red)] border border-[var(--accent-red)]/30">KILL SWITCH ON</span>
			{/if}
			<!-- OpenClaw 연결 상태 -->
			<span class="px-2.5 py-1 rounded-lg text-[10px] font-medium flex items-center gap-1.5
				{openclawReady
					? 'bg-[var(--accent-green)]/10 text-[var(--accent-green)] border border-[var(--accent-green)]/20'
					: 'bg-[var(--accent-red)]/10 text-[var(--accent-red)] border border-[var(--accent-red)]/20'
				}">
				<span class="w-1.5 h-1.5 rounded-full {openclawReady ? 'bg-[var(--accent-green)]' : 'bg-[var(--accent-red)]'}"></span>
				OpenClaw {openclawReady ? 'ON' : !openclawConn.installed ? 'Not Installed' : 'Daemon OFF'}
			</span>
			<span class="px-3 py-1 rounded-lg text-sm font-medium {dashboard.mode === 'live' ? 'bg-[var(--accent-green)]/15 text-[var(--accent-green)] border border-[var(--accent-green)]/30' : 'bg-[var(--accent-yellow)]/15 text-[var(--accent-yellow)] border border-[var(--accent-yellow)]/30'}">
				{dashboard.mode.toUpperCase()}
			</span>
			<button
				onclick={runFullPipeline}
				disabled={pipelineRunning || runnerActive}
				class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all cursor-pointer
					{pipelineRunning
						? 'bg-[var(--accent-blue)]/20 text-[var(--accent-blue)] border border-[var(--accent-blue)]/30'
						: 'bg-[var(--accent-blue)] text-white hover:opacity-90'
					}
					disabled:cursor-not-allowed disabled:opacity-50"
			>
				{#if pipelineRunning}
					<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
					</svg>
					실행 중...
				{:else}
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
						<path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
					</svg>
					1회 실행
				{/if}
			</button>
		</div>
	</div>

	<!-- ═══════════ Strategy Selector ═══════════ -->
	<div class="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-3">
				<h2 class="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Strategy</h2>
				<!-- Strategy Buttons -->
				<div class="flex items-center rounded-lg border border-[var(--border)] overflow-hidden">
					{#each STRATEGIES as strat}
						<button
							onclick={() => setStrategy(strat.name)}
							disabled={strategyLoading}
							class="px-4 py-2 text-xs font-semibold transition-all cursor-pointer disabled:cursor-not-allowed
								{currentStrategy === strat.name
									? strat.name === 'conservative'
										? 'bg-[var(--accent-blue)] text-white'
										: strat.name === 'balanced'
										? 'bg-[var(--accent-yellow)] text-black'
										: 'bg-[var(--accent-red)] text-white'
									: 'bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
								}"
						>
							{strat.label}
						</button>
					{/each}
				</div>
			</div>

			<!-- Active Strategy Summary -->
			<div class="flex items-center gap-4 text-xs">
				<span class="text-[var(--text-secondary)]">
					Lev: <strong class="text-white">{activeStrategy.leverage}</strong>
				</span>
				<span class="text-[var(--text-secondary)]">
					Risk: <strong class="text-white">{activeStrategy.risk}</strong>
				</span>
				<span class="text-[var(--text-secondary)]">
					R:R: <strong class="text-white">{activeStrategy.rr}</strong>
				</span>
				<span class="text-[var(--text-secondary)]">
					Max Pos: <strong class="text-white">{activeStrategy.maxPos}</strong>
				</span>
				<span class="text-[10px] text-[var(--text-secondary)] italic">{activeStrategy.description}</span>
			</div>
		</div>
	</div>

	<!-- ═══════════ Runner Control + Open Positions ═══════════ -->
	<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">

	<!-- Continuous Runner Control -->
	<div class="bg-[var(--bg-card)] border rounded-xl p-4
		{runnerActive
			? 'border-[var(--accent-green)]/40'
			: runnerStatus.state === 'error'
			? 'border-[var(--accent-red)]/40'
			: 'border-[var(--border)]'}">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-4">
				<!-- 상태 표시등 -->
				<div class="flex items-center gap-2">
					{#if runnerStatus.state === 'running'}
						<span class="relative flex h-3 w-3">
							<span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--accent-green)] opacity-75"></span>
							<span class="relative inline-flex rounded-full h-3 w-3 bg-[var(--accent-green)]"></span>
						</span>
						<span class="text-sm font-semibold text-[var(--accent-green)]">실행 중</span>
					{:else if runnerStatus.state === 'idle'}
						<span class="relative flex h-3 w-3">
							<span class="animate-pulse absolute inline-flex h-full w-full rounded-full bg-[var(--accent-blue)] opacity-50"></span>
							<span class="relative inline-flex rounded-full h-3 w-3 bg-[var(--accent-blue)]"></span>
						</span>
						<span class="text-sm font-semibold text-[var(--accent-blue)]">대기 중</span>
					{:else if runnerStatus.state === 'error'}
						<span class="w-3 h-3 rounded-full bg-[var(--accent-red)]"></span>
						<span class="text-sm font-semibold text-[var(--accent-red)]">오류 정지</span>
					{:else}
						<span class="w-3 h-3 rounded-full bg-[var(--text-secondary)] opacity-50"></span>
						<span class="text-sm font-semibold text-[var(--text-secondary)]">정지됨</span>
					{/if}
				</div>

				<!-- 통계 -->
				{#if runnerActive || runnerStatus.cycleCount > 0}
					<div class="flex items-center gap-3 text-xs text-[var(--text-secondary)]">
						<span>사이클: <strong class="text-white">{runnerStatus.cycleCount}</strong></span>
						<span>성공: <strong class="text-[var(--accent-green)]">{runnerStatus.successCount}</strong></span>
						{#if runnerStatus.failCount > 0}
							<span>실패: <strong class="text-[var(--accent-red)]">{runnerStatus.failCount}</strong></span>
						{/if}
						{#if runnerStatus.intervalSec > 0}
							<span>간격: {runnerStatus.intervalSec}초</span>
						{/if}
					</div>
				{/if}

				<!-- 다음 실행 카운트다운 -->
				{#if runnerStatus.state === 'idle' && runnerStatus.nextCycleAt}
					<span class="text-xs px-2 py-0.5 rounded bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]">
						다음: {formatCountdown(runnerStatus.nextCycleAt)}
					</span>
					<button
						onclick={runnerRunNow}
						class="text-xs px-2 py-0.5 rounded bg-[var(--accent-yellow)]/15 text-[var(--accent-yellow)] hover:bg-[var(--accent-yellow)]/25 cursor-pointer"
					>
						즉시 실행
					</button>
				{/if}
			</div>

			<!-- 시작/정지 버튼 -->
			<button
				onclick={toggleRunner}
				disabled={runnerLoading}
				class="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed
					{runnerActive
						? 'bg-[var(--accent-red)] text-white hover:opacity-90'
						: 'bg-[var(--accent-green)] text-white hover:opacity-90'
					}"
			>
				{#if runnerLoading}
					<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
					</svg>
				{:else if runnerActive}
					<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
					자동매매 정지
				{:else}
					<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
					자동매매 시작
				{/if}
			</button>
		</div>

		<!-- 포지션 모니터 상태 -->
		<div class="mt-3 pt-3 border-t border-[var(--border)] flex items-center justify-between">
			<div class="flex items-center gap-2">
				<span class="w-2 h-2 rounded-full {monitorStatus.state === 'running' ? 'bg-[var(--accent-green)] animate-pulse' : 'bg-[var(--text-secondary)]'}"></span>
				<span class="text-xs text-[var(--text-secondary)]">포지션 모니터</span>
				{#if monitorStatus.state === 'running'}
					<span class="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-green)]/15 text-[var(--accent-green)] font-medium">{monitorStatus.intervalSec}초 주기</span>
					{#if monitorStatus.openPositions > 0}
						<span class="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-yellow)]/15 text-[var(--accent-yellow)] font-medium">포지션 {monitorStatus.openPositions}건</span>
					{/if}
					{#if monitorStatus.closedCount > 0}
						<span class="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-purple)]/15 text-[var(--accent-purple)] font-medium">청산 {monitorStatus.closedCount}건</span>
					{/if}
					{#if monitorStatus.lastCheckAt}
						<span class="text-[10px] text-[var(--text-secondary)]">#{monitorStatus.checkCount} · {timeAgo(monitorStatus.lastCheckAt, tick)}</span>
					{/if}
				{:else}
					<span class="text-[10px] text-[var(--text-secondary)]">비활성</span>
				{/if}
			</div>
			<button
				onclick={toggleMonitor}
				class="text-[10px] px-2.5 py-1 rounded-lg cursor-pointer transition-all
					{monitorStatus.state === 'running'
						? 'bg-[var(--accent-red)]/15 text-[var(--accent-red)] hover:bg-[var(--accent-red)]/25'
						: 'bg-[var(--accent-green)]/15 text-[var(--accent-green)] hover:bg-[var(--accent-green)]/25'
					}"
			>
				{monitorStatus.state === 'running' ? '정지' : '시작'}
			</button>
		</div>

		<!-- 마지막 사이클 결과 (있을 때) -->
		{#if runnerStatus.lastCycle}
			<div class="mt-3 pt-3 border-t border-[var(--border)]">
				<div class="flex items-center gap-2 text-xs text-[var(--text-secondary)] mb-2">
					<span>마지막 사이클:</span>
					<span class="{runnerStatus.lastCycle.success ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'} font-medium">
						{runnerStatus.lastCycle.success ? '성공' : '실패'}
					</span>
					<span>({(runnerStatus.lastCycle.durationMs / 1000).toFixed(1)}초)</span>
					<span>{timeAgo(runnerStatus.lastCycle.completedAt)}</span>
				</div>
				<div class="flex flex-wrap gap-1.5">
					{#each Object.entries(runnerStatus.lastCycle.steps) as [stepId, step]}
						<span class="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium
							{step.success
								? 'bg-[var(--accent-green)]/10 text-[var(--accent-green)]'
								: 'bg-[var(--accent-red)]/10 text-[var(--accent-red)]'}"
							title={step.error || `${step.durationMs}ms`}
						>
							{#if step.success}
								<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
							{:else}
								<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
							{/if}
							{stepId}
						</span>
					{/each}
				</div>
			</div>
		{/if}

		<!-- 오류 사유 -->
		{#if runnerStatus.state === 'error' && runnerStatus.stopReason}
			<p class="mt-2 text-xs text-[var(--accent-red)]">정지 사유: {runnerStatus.stopReason}</p>
		{/if}
	</div>

	<!-- AI 파라미터 조정 알림 -->
	{#if aiAdjustment}
		<div class="bg-[var(--bg-card)] border border-[var(--accent-yellow)]/30 rounded-xl p-3">
			<div class="flex items-center justify-between mb-2">
				<div class="flex items-center gap-2">
					<svg class="w-4 h-4 text-[var(--accent-yellow)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
						<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
					</svg>
					<span class="text-[11px] font-bold text-[var(--accent-yellow)] uppercase">AI 파라미터 조정</span>
					{#if aiAdjustment.market_condition}
						<span class="text-[9px] px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] text-[var(--text-secondary)] font-medium">{aiAdjustment.market_condition}</span>
					{/if}
				</div>
				<span class="text-[9px] text-[var(--text-secondary)]">{aiAdjustment.timestamp ? timeAgo(aiAdjustment.timestamp) : ''}</span>
			</div>
			<p class="text-[10px] text-[var(--text-secondary)] mb-2">{aiAdjustment.reason}</p>
			{#if aiAdjustment.adjustments}
				<div class="flex flex-wrap gap-2">
					{#each Object.entries(aiAdjustment.adjustments) as [key, val]}
						<div class="flex items-center gap-1 text-[10px] bg-[var(--bg-secondary)] rounded px-2 py-1">
							<span class="text-[var(--text-secondary)]">{key}</span>
							<span class="font-mono text-[var(--accent-red)] line-through">{val.from}</span>
							<span class="text-[var(--text-secondary)]">→</span>
							<span class="font-mono text-[var(--accent-green)] font-bold">{val.to}</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Open Positions (HyperLiquid Live) -->
	<div class="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4">
		<div class="flex items-center justify-between mb-3">
			<div class="flex items-center gap-2">
				<h2 class="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Open Positions</h2>
				<span class="text-[9px] px-1.5 py-0.5 rounded bg-[var(--accent-blue)]/15 text-[var(--accent-blue)] font-medium">HL Live</span>
			</div>
			<span class="text-[9px] text-[var(--text-secondary)]">{hlPositions.length}건</span>
		</div>
		{#if hlPositions.length > 0}
			<div class="space-y-1.5">
				{#each hlPositions as pos}
					{@const pnlPct = pos.returnOnEquity * 100}
					{@const isProfit = pos.unrealizedPnl >= 0}
					{@const currentPrice = (() => {
						const lp = livePrices.find(p => p.symbol === pos.coin);
						return lp?.hl_price || pos.entryPx;
					})()}
					{@const posKey = `${pos.coin}-${pos.side}`}
					<div class="py-2 px-3 rounded-lg bg-[var(--bg-secondary)]">
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-2">
								<span class="font-medium text-sm">{pos.coin}</span>
								<span class="px-1.5 py-0.5 rounded text-[10px] font-semibold {pos.side === 'LONG' ? 'bg-[var(--accent-green)]/15 text-[var(--accent-green)]' : 'bg-[var(--accent-red)]/15 text-[var(--accent-red)]'}">{pos.side}</span>
								<span class="text-[10px] text-[var(--text-secondary)]">{pos.leverage}x {pos.leverageType}</span>
							</div>
							<div class="flex items-center gap-2">
								<div class="text-right">
									<span class="text-sm font-mono font-semibold {isProfit ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}">
										{isProfit ? '+' : ''}{pos.unrealizedPnl.toFixed(2)} USD
									</span>
									<span class="text-[10px] ml-1 {isProfit ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}">
										({isProfit ? '+' : ''}{pnlPct.toFixed(2)}%)
									</span>
								</div>
								<button
									onclick={() => closePositionAction(pos.coin, pos.side)}
									disabled={closingPositions.has(posKey)}
									class="px-2 py-1 rounded text-[10px] font-semibold cursor-pointer transition-all
										bg-[var(--accent-red)]/10 text-[var(--accent-red)] hover:bg-[var(--accent-red)]/25
										disabled:opacity-40 disabled:cursor-not-allowed"
									title="{pos.coin} {pos.side} 포지션 청산"
								>
									{#if closingPositions.has(posKey)}
										<svg class="w-3 h-3 animate-spin inline" fill="none" viewBox="0 0 24 24">
											<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
											<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
										</svg>
									{:else}
										청산
									{/if}
								</button>
							</div>
						</div>
						<div class="flex items-center justify-between mt-1 text-[10px] text-[var(--text-secondary)]">
							<div class="flex gap-3">
								<span>진입 <span class="font-mono text-[var(--text-primary)]">${pos.entryPx.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></span>
								<span>현재 <span class="font-mono text-[var(--text-primary)]">${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></span>
								{#if pos.liquidationPx}
									<span>청산 <span class="font-mono text-[var(--accent-red)]">${pos.liquidationPx.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></span>
								{/if}
							</div>
							<span>수량 <span class="font-mono">{pos.size}</span> · 가치 <span class="font-mono">${pos.positionValue.toFixed(2)}</span></span>
						</div>
					</div>
				{/each}
			</div>
			<!-- 총 미실현 손익 -->
			{@const totalPnl = hlPositions.reduce((sum, p) => sum + p.unrealizedPnl, 0)}
			<div class="mt-2 pt-2 border-t border-[var(--border)] flex items-center justify-between text-xs">
				<span class="text-[var(--text-secondary)]">총 미실현 PnL</span>
				<span class="font-mono font-semibold {totalPnl >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}">
					{totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)} USD
				</span>
			</div>
		{:else}
			<p class="text-[var(--text-secondary)] text-sm py-4 text-center">포지션 없음</p>
		{/if}
	</div>

	</div><!-- /grid Runner + Positions -->

	<!-- OpenClaw Pipeline Progress -->
	{#if pipelineSteps.length > 0 || openclawState.state !== 'idle'}
		<div class="bg-[var(--bg-card)] border rounded-xl overflow-hidden
			{openclawState.state === 'failed' || pipelineHasError ? 'border-[var(--accent-red)]/30' :
			 openclawState.state === 'done' || pipelineDone ? 'border-[var(--accent-green)]/30' :
			 'border-[var(--accent-blue)]/30'}">
			<div class="px-4 py-3 flex items-center justify-between">
				<div class="flex items-center gap-3">
					{#if openclawState.state === 'running'}
						<svg class="w-4 h-4 animate-spin text-[var(--accent-blue)]" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
						</svg>
					{:else if openclawState.state === 'done'}
						<svg class="w-4 h-4 text-[var(--accent-green)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
						</svg>
					{:else if openclawState.state === 'failed'}
						<svg class="w-4 h-4 text-[var(--accent-red)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
						</svg>
					{/if}
					<span class="text-sm font-semibold">
						{#if openclawState.state === 'running'}
							OpenClaw 에이전트 실행 중...
						{:else if openclawState.state === 'done'}
							OpenClaw 파이프라인 완료
						{:else if openclawState.state === 'failed'}
							OpenClaw 파이프라인 실패
						{:else}
							Pipeline
						{/if}
					</span>
					{#if openclawState.state === 'running' && openclawState.startedAt}
						<span class="text-[10px] text-[var(--text-secondary)]">{timeAgo(openclawState.startedAt)}</span>
					{/if}
				</div>
				<button onclick={() => pipelineExpanded = !pipelineExpanded} class="text-xs text-[var(--text-secondary)] hover:text-white cursor-pointer">
					{pipelineExpanded ? '접기' : '펼치기'}
				</button>
			</div>
			{#if pipelineExpanded}
				<div class="border-t border-[var(--border)] px-4 py-3">
					{#if openclawState.output}
						<div class="max-h-[400px] overflow-y-auto rounded-lg bg-[var(--bg-secondary)] p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-[var(--text-secondary)]">
							{@html formatOpenClawOutput(openclawState.output)}
						</div>
					{:else if openclawState.state === 'running'}
						<div class="flex items-center justify-center py-6 text-[var(--text-secondary)] text-sm">
							<svg class="w-5 h-5 animate-spin mr-2" fill="none" viewBox="0 0 24 24">
								<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
								<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
							</svg>
							OpenClaw 에이전트가 트레이딩 파이프라인을 분석 중입니다...
						</div>
					{:else if pipelineSteps.length > 0}
						{#each pipelineSteps as step}
							<div class="flex items-center gap-3 px-3 py-2 rounded-lg bg-[var(--bg-secondary)]">
								<span class="text-sm {step.status === 'failed' ? 'text-[var(--accent-red)]' : 'text-[var(--text-secondary)]'}">{step.label}</span>
								{#if step.result?.error}<span class="text-xs text-[var(--accent-red)]">{step.result.error}</span>{/if}
							</div>
						{/each}
					{/if}
				</div>
			{/if}
		</div>
	{/if}

	<!-- ═══════════ Chart + Recent Trades (side by side) ═══════════ -->
	<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
		<!-- Price Chart (선택된 코인) -->
		<div class="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-3">
			<div class="flex items-center justify-between mb-2">
				<div class="flex items-center gap-2">
					<h2 class="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider">{chartSymbol} Chart</h2>
					<div class="flex items-center gap-4 text-[10px]">
						<span class="flex items-center gap-1"><span class="w-2.5 h-0.5 bg-[#eab308] inline-block"></span> Binance</span>
						<span class="flex items-center gap-1"><span class="w-2.5 h-0.5 bg-[#a855f7] inline-block"></span> HL</span>
					</div>
				</div>
				<div class="flex items-center gap-1">
					{#each ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE'] as sym}
						<button
							onclick={() => selectChartSymbol(sym)}
							class="text-[9px] px-1.5 py-0.5 rounded cursor-pointer transition-all
								{chartSymbol === sym
									? 'bg-[var(--accent-blue)] text-white font-bold'
									: 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-white'
								}"
						>{sym}</button>
					{/each}
				</div>
			</div>
			{#if chartData[chartSymbol] && chartData[chartSymbol].length > 0}
				{#key chartSymbol}
					<PriceChart symbol={chartSymbol} data={chartData[chartSymbol]} />
				{/key}
			{:else}
				<div class="flex items-center justify-center h-[280px] text-[var(--text-secondary)] text-xs">
					<p>차트 데이터 로딩 중...</p>
				</div>
			{/if}
		</div>

		<!-- Recent Trades -->
		<div class="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl px-3 py-2">
			<div class="flex items-center justify-between mb-1">
				<h2 class="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Recent Trades</h2>
				<a href="/trades" class="text-[10px] text-[var(--accent-blue)] hover:underline">View all</a>
			</div>
			<TradesTable trades={dashboard.recentTrades} mini {livePrices} onSymbolClick={selectChartSymbol} />
		</div>
	</div>

	<!-- ═══════════ Wallet Balances + Deposit Addresses ═══════════ -->
	<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
		<!-- Balance Cards (실시간 API 조회) -->
		<div class="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4">
			<div class="flex items-center justify-between mb-3">
				<h2 class="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Wallet Balances</h2>
				{#if liveBalances}
					<span class="flex items-center gap-1 text-[10px] text-[var(--text-secondary)]">
						<span class="w-1.5 h-1.5 rounded-full bg-[var(--accent-green)] animate-pulse"></span>
						Live
					</span>
				{/if}
			</div>
			<div class="grid grid-cols-3 gap-3">
				<div class="bg-[var(--bg-secondary)] rounded-lg p-3 text-center">
					<p class="text-[10px] text-[var(--accent-blue)] font-medium mb-1">Coinbase</p>
					<p class="text-xl font-bold text-[var(--accent-blue)]">
						{liveBalances ? `$${liveBalances.coinbase.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : dashboard.balance ? `$${dashboard.balance.coinbase.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : 'N/A'}
					</p>
					<p class="text-[10px] text-[var(--text-secondary)]">Base Network</p>
				</div>
				<div class="bg-[var(--bg-secondary)] rounded-lg p-3 text-center">
					<p class="text-[10px] text-[var(--accent-purple)] font-medium mb-1">HyperLiquid</p>
					<p class="text-xl font-bold text-[var(--accent-purple)]">
						{liveBalances ? `$${liveBalances.hyperliquid.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : dashboard.balance ? `$${dashboard.balance.hyperliquid.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : 'N/A'}
					</p>
					<p class="text-[10px] text-[var(--text-secondary)]">Arbitrum</p>
				</div>
				<div class="bg-[var(--bg-secondary)] rounded-lg p-3 text-center">
					<p class="text-[10px] text-white font-medium mb-1">Total</p>
					<p class="text-xl font-bold text-white">
						{liveBalances ? `$${liveBalances.total.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : dashboard.balance ? `$${dashboard.balance.total.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : 'N/A'}
					</p>
					<p class="text-[10px] text-[var(--text-secondary)]">Combined</p>
				</div>
			</div>
			{#if liveBalances?.hlDetail && (liveBalances.hlDetail.spot.length > 0 || liveBalances.hlDetail.perp > 0)}
				<div class="mt-3 border-t border-[var(--border)] pt-3">
					<p class="text-[10px] text-[var(--text-secondary)] font-medium mb-2 uppercase tracking-wider">HyperLiquid 상세</p>
					<div class="space-y-1">
						{#if liveBalances.hlDetail.perp > 0}
							<div class="flex justify-between text-xs">
								<span class="text-[var(--text-secondary)]">Perp Margin</span>
								<span class="text-[var(--accent-purple)] font-medium">${liveBalances.hlDetail.perp.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
							</div>
						{/if}
						{#each liveBalances.hlDetail.spot as s}
							<div class="flex justify-between text-xs">
								<span class="text-[var(--text-secondary)]">{s.coin} <span class="opacity-50">{s.total}</span></span>
								<span class="text-[var(--accent-purple)] font-medium">${s.usdValue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
							</div>
						{/each}
					</div>
				</div>
			{/if}
			{#if liveBalances}
				<p class="text-[10px] text-[var(--text-secondary)] mt-2 text-right">
					Updated: {new Date(liveBalances.timestamp).toLocaleTimeString('ko-KR')}
				</p>
			{/if}
		</div>

		<!-- 내 입금 지갑 주소 + 자동입금 -->
		<div class="bg-[var(--bg-card)] border border-[var(--accent-green)]/30 rounded-xl p-4">
			<div class="flex items-center gap-2 mb-3">
				<svg class="w-4 h-4 text-[var(--accent-green)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
				</svg>
				<h2 class="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider">내 입금 지갑</h2>
			</div>

			<!-- HyperLiquid 입금 주소 -->
			{#if walletAddresses?.hyperliquid}
				<div class="bg-[var(--bg-secondary)] rounded-lg p-3 mb-3">
					<div class="flex items-center gap-2 mb-2">
						<span class="w-2.5 h-2.5 rounded-full bg-[var(--accent-purple)]"></span>
						<span class="text-xs font-semibold text-[var(--accent-purple)]">HyperLiquid</span>
						<span class="text-[9px] px-1 py-0.5 rounded bg-[var(--accent-purple)]/15 text-[var(--accent-purple)]">Arbitrum</span>
					</div>
					<div class="flex items-center gap-2">
						<code class="flex-1 text-xs font-mono text-[var(--text-primary)] bg-[var(--bg-card)] px-2.5 py-2 rounded border border-[var(--border)] break-all select-all">
							{walletAddresses.hyperliquid.address}
						</code>
						<button
							onclick={() => walletAddresses?.hyperliquid && copyAddress(walletAddresses.hyperliquid.address, 'hl_main')}
							class="flex-shrink-0 p-2 rounded-lg bg-[var(--accent-purple)] text-white hover:opacity-90 transition-opacity cursor-pointer"
							title="주소 복사"
						>
							{#if copiedId === 'hl_main'}
								<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
							{:else}
								<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
							{/if}
						</button>
					</div>
					<!-- Arbitrum → HL 자동입금 -->
					<div class="mt-2 pt-2 border-t border-[var(--border)]">
						<div class="flex items-center justify-between gap-2">
							<div class="flex items-center gap-2">
								<span class="text-[10px] text-[var(--text-secondary)]">Arbitrum USDC:</span>
								{#if depositChecking}
									<span class="text-[10px] text-[var(--text-secondary)] animate-pulse">확인중...</span>
								{:else if arbUsdcBalance !== null}
									<span class="text-xs font-bold text-[var(--accent-green)]">${arbUsdcBalance}</span>
								{:else}
									<button onclick={checkArbBalance} class="text-[10px] text-[var(--accent-blue)] hover:underline cursor-pointer">잔고 확인</button>
								{/if}
							</div>
							<button
								onclick={executeDeposit}
								disabled={depositLoading}
								class="text-[10px] px-3 py-1.5 rounded-lg bg-[var(--accent-green)] text-black font-bold hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer disabled:cursor-wait"
							>
								{#if depositLoading}
									입금 중...
								{:else}
									Arbitrum → HL 입금
								{/if}
							</button>
						</div>
						{#if depositResult}
							<div class="mt-2 text-[10px] rounded p-2 {depositResult.status === 'success' ? 'bg-[var(--accent-green)]/10 text-[var(--accent-green)]' : 'bg-[var(--accent-red)]/10 text-[var(--accent-red)]'}">
								{#if depositResult.status === 'success'}
									입금 완료: {depositResult.amount} USDC
									{#if depositResult.arbiscan}
										<a href={depositResult.arbiscan} target="_blank" class="underline ml-1">Tx 보기</a>
									{/if}
								{:else}
									오류: {depositResult.error || '알 수 없는 오류'}
								{/if}
							</div>
						{/if}
					</div>
				</div>
			{/if}

			<!-- Coinbase 입금 주소 -->
			{#if walletAddresses?.coinbase?.address}
				<div class="bg-[var(--bg-secondary)] rounded-lg p-3">
					<div class="flex items-center gap-2 mb-2">
						<span class="w-2.5 h-2.5 rounded-full bg-[var(--accent-blue)]"></span>
						<span class="text-xs font-semibold text-[var(--accent-blue)]">Coinbase</span>
						<span class="text-[9px] px-1 py-0.5 rounded bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]">Base</span>
					</div>
					<div class="flex items-center gap-2">
						<code class="flex-1 text-xs font-mono text-[var(--text-primary)] bg-[var(--bg-card)] px-2.5 py-2 rounded border border-[var(--border)] break-all select-all">
							{walletAddresses.coinbase.address}
						</code>
						<button
							onclick={() => walletAddresses?.coinbase?.address && copyAddress(walletAddresses.coinbase.address, 'cb_main')}
							class="flex-shrink-0 p-2 rounded-lg bg-[var(--accent-blue)] text-white hover:opacity-90 transition-opacity cursor-pointer"
							title="주소 복사"
						>
							{#if copiedId === 'cb_main'}
								<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
							{:else}
								<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
							{/if}
						</button>
					</div>
				</div>
			{/if}

			{#if !walletAddresses?.hyperliquid && !walletAddresses?.coinbase?.address}
				<p class="text-xs text-[var(--accent-red)] py-2">.env에 HYPERLIQUID_DEPOSIT_ADDRESS를 설정해주세요</p>
			{/if}
		</div>
	</div>

	<!-- KPI Cards (10s refresh) -->
	<div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
		<KpiCard label="Today PnL" value={`${pnlSign}$${dashboard.todayPnl.toFixed(2)}`} color={pnlColor} sub={`Fees: $${dashboard.todayFees.toFixed(2)}`} />
		<KpiCard label="Win Rate" value={`${dashboard.winRate}%`} color={dashboard.winRate >= 50 ? 'green' : 'red'} sub={`${dashboard.todayTradeCount} trades today`} />
		<KpiCard label="Open Positions" value={String(dashboard.openPositionCount)} color="blue" />
		<KpiCard label="Total Balance" value={liveBalances ? `$${liveBalances.total.toLocaleString(undefined, {minimumFractionDigits: 2})}` : dashboard.balance ? `$${dashboard.balance.total.toLocaleString(undefined, {minimumFractionDigits: 2})}` : 'N/A'} color="purple" sub={liveBalances ? `CB: $${liveBalances.coinbase.toFixed(0)} | HL: $${liveBalances.hyperliquid.toFixed(0)}` : dashboard.balance ? `CB: $${dashboard.balance.coinbase.toFixed(0)} | HL: $${dashboard.balance.hyperliquid.toFixed(0)}` : ''} />
	</div>

	<!-- ═══════════ AI 분석 판단 + 거래 활동 로그 ═══════════ -->
	<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">

	<!-- AI 분석 판단 -->
	<div class="bg-[var(--bg-card)] border border-[var(--accent-blue)]/30 rounded-xl p-4">
		<div class="flex items-center justify-between mb-4">
			<div class="flex items-center gap-2">
				<svg class="w-5 h-5 text-[var(--accent-blue)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
				</svg>
				<h2 class="text-sm font-bold uppercase tracking-wider">AI 분석 판단</h2>
				{#if signals?.generated_at}
					<span class="text-[10px] text-[var(--text-secondary)]">{timeAgo(signals.generated_at)}</span>
				{/if}
			</div>
			<div class="flex items-center gap-2">
				{#if signals?.signals}
					{@const longCount = signals.signals.filter((s: any) => s.action === 'LONG').length}
					{@const shortCount = signals.signals.filter((s: any) => s.action === 'SHORT').length}
					{@const holdCount = signals.signals.filter((s: any) => s.action === 'HOLD').length}
					<span class="text-[10px] px-2 py-0.5 rounded bg-[var(--accent-green)]/15 text-[var(--accent-green)] font-medium">LONG {longCount}</span>
					<span class="text-[10px] px-2 py-0.5 rounded bg-[var(--accent-red)]/15 text-[var(--accent-red)] font-medium">SHORT {shortCount}</span>
					<span class="text-[10px] px-2 py-0.5 rounded bg-[var(--border)]/50 text-[var(--text-secondary)] font-medium">HOLD {holdCount}</span>
				{/if}
			</div>
		</div>

		{#if signals?.signals}
			<!-- 시그널 상세 (LONG/SHORT만 표시, HOLD 접기) -->
			{@const activeSignals = signals.signals.filter((s: any) => s.action !== 'HOLD')}
			{@const holdSignals = signals.signals.filter((s: any) => s.action === 'HOLD')}

			{#if activeSignals.length > 0}
				<div class="space-y-2 mb-3">
					{#each activeSignals as sig}
						<div class="rounded-lg bg-[var(--bg-secondary)] overflow-hidden">
							<!-- 시그널 헤더 (클릭하면 상세 열림) -->
							<button
								onclick={() => signalExpanded = signalExpanded === sig.symbol ? null : sig.symbol}
								class="w-full flex items-center justify-between px-3 py-2.5 cursor-pointer hover:bg-[var(--border)]/20 transition-colors"
							>
								<div class="flex items-center gap-3">
									<span class="text-sm font-bold">{sig.symbol}</span>
									<SignalBadge action={sig.action} confidence={sig.confidence} />
									<span class="text-[10px] font-mono text-[var(--text-secondary)]">Score: {sig.analysis?.composite_score?.toFixed(3) ?? '-'}</span>
								</div>
								<div class="flex items-center gap-3">
									<div class="text-right">
										<span class="text-xs font-mono">${formatPrice(sig.entry_price)}</span>
										{#if sig.stop_loss && sig.take_profit}
											<span class="text-[9px] text-[var(--text-secondary)] ml-2">SL ${formatPrice(sig.stop_loss)} / TP ${formatPrice(sig.take_profit)}</span>
										{/if}
									</div>
									<svg class="w-4 h-4 text-[var(--text-secondary)] transition-transform {signalExpanded === sig.symbol ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
										<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
									</svg>
								</div>
							</button>

							<!-- 지표 상세 (열렸을 때) -->
							{#if signalExpanded === sig.symbol && sig.analysis}
								<div class="border-t border-[var(--border)] px-3 py-3">
									<div class="grid grid-cols-5 gap-2">
										<!-- Spread -->
										<div class="text-center">
											<p class="text-[9px] text-[var(--text-secondary)] uppercase mb-1">Spread</p>
											<p class="text-xs font-mono font-bold
												{sig.analysis.spread?.signal?.includes('LONG') ? 'text-[var(--accent-green)]' :
												 sig.analysis.spread?.signal?.includes('SHORT') ? 'text-[var(--accent-red)]' :
												 'text-[var(--text-secondary)]'}">
												{sig.analysis.spread?.signal ?? '-'}
											</p>
											<p class="text-[9px] text-[var(--text-secondary)]">
												{sig.analysis.spread?.value_pct != null ? (sig.analysis.spread.value_pct * 100).toFixed(3) + '%' : '-'}
											</p>
										</div>
										<!-- RSI -->
										<div class="text-center">
											<p class="text-[9px] text-[var(--text-secondary)] uppercase mb-1">RSI</p>
											<p class="text-xs font-mono font-bold
												{sig.analysis.rsi?.signal?.includes('LONG') ? 'text-[var(--accent-green)]' :
												 sig.analysis.rsi?.signal?.includes('SHORT') ? 'text-[var(--accent-red)]' :
												 'text-[var(--text-secondary)]'}">
												{sig.analysis.rsi?.signal ?? '-'}
											</p>
											<p class="text-[9px] text-[var(--text-secondary)]">{sig.analysis.rsi?.value?.toFixed(1) ?? '-'}</p>
										</div>
										<!-- MACD -->
										<div class="text-center">
											<p class="text-[9px] text-[var(--text-secondary)] uppercase mb-1">MACD</p>
											<p class="text-xs font-mono font-bold
												{sig.analysis.macd?.signal?.includes('LONG') ? 'text-[var(--accent-green)]' :
												 sig.analysis.macd?.signal?.includes('SHORT') ? 'text-[var(--accent-red)]' :
												 'text-[var(--text-secondary)]'}">
												{sig.analysis.macd?.signal ?? '-'}
											</p>
											<p class="text-[9px] text-[var(--text-secondary)]">H: {sig.analysis.macd?.histogram?.toFixed(2) ?? '-'}</p>
										</div>
										<!-- Bollinger -->
										<div class="text-center">
											<p class="text-[9px] text-[var(--text-secondary)] uppercase mb-1">BB</p>
											<p class="text-xs font-mono font-bold
												{sig.analysis.bollinger?.signal?.includes('LONG') ? 'text-[var(--accent-green)]' :
												 sig.analysis.bollinger?.signal?.includes('SHORT') ? 'text-[var(--accent-red)]' :
												 'text-[var(--text-secondary)]'}">
												{sig.analysis.bollinger?.signal ?? '-'}
											</p>
											<p class="text-[9px] text-[var(--text-secondary)]">{sig.analysis.bollinger?.position ?? '-'}</p>
										</div>
										<!-- MA -->
										<div class="text-center">
											<p class="text-[9px] text-[var(--text-secondary)] uppercase mb-1">MA</p>
											<p class="text-xs font-mono font-bold
												{sig.analysis.ma?.signal?.includes('LONG') ? 'text-[var(--accent-green)]' :
												 sig.analysis.ma?.signal?.includes('SHORT') ? 'text-[var(--accent-red)]' :
												 'text-[var(--text-secondary)]'}">
												{sig.analysis.ma?.signal ?? '-'}
											</p>
											<p class="text-[9px] text-[var(--text-secondary)]">
												{sig.analysis.ma?.ma_7?.toFixed(0) ?? '-'}/{sig.analysis.ma?.ma_25?.toFixed(0) ?? '-'}
											</p>
										</div>
									</div>

									<!-- 판단 요약 -->
									<div class="mt-3 pt-2 border-t border-[var(--border)]">
										<p class="text-[10px] text-[var(--text-secondary)]">
											<strong class="text-white">판단 근거:</strong>
											Composite Score <strong class="{sig.analysis.composite_score > 0 ? 'text-[var(--accent-green)]' : sig.analysis.composite_score < 0 ? 'text-[var(--accent-red)]' : 'text-white'}">{sig.analysis.composite_score?.toFixed(3)}</strong>
											{#if sig.action === 'LONG'}
												→ 임계값({activeStrategy.name === 'aggressive' ? '0.15' : activeStrategy.name === 'conservative' ? '0.50' : '0.30'}) 초과하여 <strong class="text-[var(--accent-green)]">매수 진입</strong>
											{:else if sig.action === 'SHORT'}
												→ 임계값 하회하여 <strong class="text-[var(--accent-red)]">매도 진입</strong>
											{/if}
											{#if sig.risk?.atr}
												| ATR: {sig.risk.atr.toFixed(2)} | R:R: {sig.risk.risk_reward_ratio?.toFixed(1)}
											{/if}
										</p>
									</div>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{:else}
				<p class="text-[var(--text-secondary)] text-xs py-2 text-center">모든 코인이 HOLD — 진입 조건 미충족</p>
			{/if}

			<!-- HOLD 시그널 축약 -->
			{#if holdSignals.length > 0}
				<div class="flex flex-wrap gap-1 mt-1">
					<span class="text-[9px] text-[var(--text-secondary)] mr-1">HOLD:</span>
					{#each holdSignals.slice(0, 20) as sig}
						<span class="text-[9px] px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] text-[var(--text-secondary)] font-mono">{sig.symbol}</span>
					{/each}
					{#if holdSignals.length > 20}
						<span class="text-[9px] text-[var(--text-secondary)]">+{holdSignals.length - 20}개</span>
					{/if}
				</div>
			{/if}
		{:else}
			<p class="text-[var(--text-secondary)] text-sm py-4 text-center">시그널 없음 — 가격 수집 후 분석을 실행하세요</p>
		{/if}
	</div>

	<!-- 거래 활동 로그 -->
	<div class="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4">
		<div class="flex items-center justify-between mb-3">
			<div class="flex items-center gap-2">
				<h2 class="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider">거래 활동 로그</h2>
				{#if runnerActive}
					<span class="w-1.5 h-1.5 rounded-full bg-[var(--accent-green)] animate-pulse"></span>
				{/if}
			</div>
			<span class="text-[9px] text-[var(--text-secondary)]">10s refresh</span>
		</div>
		{#if runnerLog.length > 0}
			<div class="h-[320px] overflow-y-auto rounded-lg bg-[var(--bg-secondary)] p-2 font-mono text-[10px] leading-relaxed space-y-px">
				{#each [...runnerLog].reverse() as line}
					<p class="
						{line.includes('ERROR') || line.includes('error') || line.includes('실패')
							? 'text-[var(--accent-red)]'
							: line.includes('LONG') || line.includes('매수') || line.includes('성공')
							? 'text-[var(--accent-green)]'
							: line.includes('SHORT') || line.includes('매도')
							? 'text-[var(--accent-yellow)]'
							: line.includes('HOLD') || line.includes('스킵')
							? 'text-[var(--text-secondary)] opacity-60'
							: line.includes('cycle') || line.includes('사이클') || line.includes('===')
							? 'text-[var(--accent-blue)]'
							: 'text-[var(--text-secondary)]'
						}">{line}</p>
				{/each}
			</div>
		{:else}
			<div class="h-[320px] flex items-center justify-center text-[var(--text-secondary)] text-xs">
				<p>자동매매를 시작하면 여기에 실시간 로그가 표시됩니다</p>
			</div>
		{/if}
	</div>

	</div><!-- /grid AI분석 + 로그 -->

	<!-- Available Trading Coins -->
	{#if availableCoins.length > 0}
		{@const activeSymbols = configSymbols}
		{@const displayCoins = showAllCoins ? availableCoins : availableCoins.slice(0, 20)}
		<div class="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4">
			<div class="flex items-center justify-between mb-3">
				<div class="flex items-center gap-2">
					<h2 class="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider">거래 가능 코인</h2>
					<span class="text-xs px-2 py-0.5 rounded-full bg-[var(--accent-blue)]/15 text-[var(--accent-blue)] font-medium">{availableCoins.length}개</span>
				</div>
				<button onclick={() => showAllCoins = !showAllCoins} class="text-xs text-[var(--accent-blue)] hover:underline cursor-pointer">
					{showAllCoins ? '접기' : `전체 보기 (${availableCoins.length})`}
				</button>
			</div>
			<div class="flex flex-wrap gap-1.5">
				{#each displayCoins as coin}
					{@const isActive = activeSymbols.includes(coin.name)}
					<span class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors
						{isActive
							? 'bg-[var(--accent-green)]/15 text-[var(--accent-green)] border border-[var(--accent-green)]/30'
							: 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] border border-[var(--border)] hover:text-[var(--text-primary)]'
						}">
						{#if isActive}
							<span class="w-1.5 h-1.5 rounded-full bg-[var(--accent-green)]"></span>
						{/if}
						{coin.name}
						<span class="text-[10px] opacity-60">{coin.maxLeverage}x</span>
					</span>
				{/each}
			</div>
			<p class="text-[10px] text-[var(--text-secondary)] mt-2">
				<span class="inline-flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-[var(--accent-green)]"></span> 현재 봇 설정에서 활성</span>
				&middot; config.yaml에서 심볼 추가 가능
			</p>
		</div>
	{/if}

	<!-- Refresh Info -->
	<div class="text-center text-[10px] text-[var(--text-secondary)] py-1">
		Prices: 3s &middot; Dashboard: 10s &middot; Charts: 60s &middot; Binance quota-safe (DB read only)
	</div>
</div>
