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

	let { data } = $props();
	let dashboard: DashboardData = $state(data.dashboard as any);
	let signals: any = $state(data.signals);
	let livePrices: LivePrice[] = $state(data.livePrices as any ?? []);
	let walletAddresses: WalletAddresses = $state(data.walletAddresses as any);
	let liveBalances: LiveBalance | null = $state(data.liveBalances as any ?? null);
	let availableCoins: TradableCoin[] = $state(data.availableCoins as any ?? []);
	let configSymbols: string[] = $state(data.configSymbols as any ?? []);
	let chartData: Record<string, { time: string; binance: number; hyperliquid: number }[]> = $state({});
	let lastPriceUpdate = $state(Date.now());
	let copiedId = $state('');
	let showAllCoins = $state(false);

	// Pipeline state
	type PipelineStep = { id: string; label: string; status: 'pending' | 'running' | 'done' | 'failed'; result?: BotResult };
	let pipelineRunning = $state(false);
	let pipelineSteps: PipelineStep[] = $state([]);
	let pipelineExpanded = $state(false);

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

	// ─── Tiered refresh intervals ───
	// Prices: every 3s (lightweight, DB-only)
	// Dashboard KPI + Signals + Runner: every 10s (moderate)
	// Charts: every 60s (heavier query)
	$effect(() => {
		// Fast: Live prices every 3s
		const priceInterval = setInterval(async () => {
			try {
				const res = await fetch('/api/prices');
				const d = await res.json();
				livePrices = d.prices;
				lastPriceUpdate = d.ts;
			} catch { /* ignore */ }
		}, 3000);

		// Medium: Dashboard + signals + balances + runner every 10s
		fetchRunnerStatus();
		const dashInterval = setInterval(async () => {
			try {
				const [dRes, sRes, bRes] = await Promise.all([
					fetch('/api/dashboard'),
					fetch('/api/signals'),
					fetch('/api/balances'),
				]);
				dashboard = await dRes.json();
				const sData = await sRes.json();
				signals = sData.signals;
				liveBalances = await bRes.json();
			} catch { /* ignore */ }
			fetchRunnerStatus();
		}, 10000);

		// Slow: Charts + coins every 60s (heavier query)
		loadChartData();
		loadCoins();
		const chartInterval = setInterval(loadChartData, 60000);

		return () => {
			clearInterval(priceInterval);
			clearInterval(dashInterval);
			clearInterval(chartInterval);
		};
	});

	async function fetchRunnerStatus() {
		try {
			const res = await fetch('/api/bot/runner');
			runnerStatus = await res.json();
		} catch { /* ignore */ }
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

	let runnerActive = $derived(runnerStatus.state === 'running' || runnerStatus.state === 'idle');

	async function loadCoins() {
		try {
			const res = await fetch('/api/coins');
			const d = await res.json();
			availableCoins = d.coins;
		} catch { /* ignore */ }
	}

	async function loadChartData() {
		try {
			const [btcRes, ethRes] = await Promise.all([
				fetch('/api/snapshots?symbol=BTC&limit=100'),
				fetch('/api/snapshots?symbol=ETH&limit=100'),
			]);
			const btc = await btcRes.json();
			const eth = await ethRes.json();
			chartData = { BTC: btc.data, ETH: eth.data };
		} catch { /* ignore */ }
	}

	async function runFullPipeline() {
		if (pipelineRunning) return;
		pipelineRunning = true;
		pipelineExpanded = true;
		pipelineSteps = [
			{ id: 'collect', label: '가격 수집', status: 'pending' },
			{ id: 'analyze', label: '시그널 분석', status: 'pending' },
			{ id: 'auto-rebalance', label: '자금 리밸런싱', status: 'pending' },
			{ id: 'trade', label: '거래 실행', status: 'pending' },
			{ id: 'monitor', label: '포지션 모니터링', status: 'pending' },
		];

		for (let i = 0; i < pipelineSteps.length; i++) {
			pipelineSteps[i].status = 'running';
			try {
				const res = await fetch('/api/bot/run', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ script: pipelineSteps[i].id }),
				});
				const result: BotResult = await res.json();
				pipelineSteps[i].result = result;
				pipelineSteps[i].status = result.success ? 'done' : 'failed';

				// collect/analyze 실패 시만 파이프라인 중단 (rebalance 실패는 계속 진행)
				if (!result.success && (pipelineSteps[i].id === 'collect' || pipelineSteps[i].id === 'analyze')) {
					for (let j = i + 1; j < pipelineSteps.length; j++) {
						pipelineSteps[j].status = 'pending';
					}
					break;
				}
			} catch (e) {
				pipelineSteps[i].result = { success: false, error: String(e) };
				pipelineSteps[i].status = 'failed';
				break;
			}

			// Refresh dashboard data after each step
			try {
				const [dRes, sRes] = await Promise.all([
					fetch('/api/dashboard'),
					fetch('/api/signals'),
				]);
				dashboard = await dRes.json();
				const sData = await sRes.json();
				signals = sData.signals;
			} catch { /* ignore */ }
		}

		pipelineRunning = false;
		loadChartData();
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

	function timeAgo(ts: string) {
		if (!ts) return '';
		const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
		if (diff < 5) return 'just now';
		if (diff < 60) return `${diff}s ago`;
		if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
		return `${Math.floor(diff / 3600)}h ago`;
	}

	function formatPrice(price: number) {
		if (price >= 10000) return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
		if (price >= 100) return price.toFixed(2);
		return price.toFixed(4);
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
					Running...
				{:else}
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
						<path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
					</svg>
					Run Once
				{/if}
			</button>
		</div>
	</div>

	<!-- ═══════════ Continuous Runner Control ═══════════ -->
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

	<!-- Pipeline Progress -->
	{#if pipelineSteps.length > 0}
		<div class="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl overflow-hidden {pipelineHasError ? 'border-[var(--accent-red)]/30' : pipelineDone ? 'border-[var(--accent-green)]/30' : 'border-[var(--accent-blue)]/30'}">
			<div class="px-4 py-3 flex items-center justify-between">
				<div class="flex items-center gap-3">
					<span class="text-sm font-semibold">
						{#if pipelineRunning}Pipeline Running{:else if pipelineHasError}Pipeline Failed{:else}Pipeline Complete{/if}
					</span>
					<div class="flex items-center gap-1.5">
						{#each pipelineSteps as step}
							<div class="w-2.5 h-2.5 rounded-full transition-colors
								{step.status === 'done' ? 'bg-[var(--accent-green)]' :
								 step.status === 'running' ? 'bg-[var(--accent-blue)] animate-pulse' :
								 step.status === 'failed' ? 'bg-[var(--accent-red)]' :
								 'bg-[var(--border)]'}"
								title={step.label}
							></div>
						{/each}
					</div>
				</div>
				<button onclick={() => pipelineExpanded = !pipelineExpanded} class="text-xs text-[var(--text-secondary)] hover:text-white cursor-pointer">
					{pipelineExpanded ? 'Collapse' : 'Expand'}
				</button>
			</div>
			{#if pipelineExpanded}
				<div class="border-t border-[var(--border)] px-4 py-3 space-y-2">
					{#each pipelineSteps as step, i}
						<div class="flex items-center gap-3 px-3 py-2 rounded-lg bg-[var(--bg-secondary)]">
							<span class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0
								{step.status === 'done' ? 'bg-[var(--accent-green)]/20 text-[var(--accent-green)]' :
								 step.status === 'running' ? 'bg-[var(--accent-blue)]/20 text-[var(--accent-blue)]' :
								 step.status === 'failed' ? 'bg-[var(--accent-red)]/20 text-[var(--accent-red)]' :
								 'bg-[var(--border)] text-[var(--text-secondary)]'}">
								{#if step.status === 'done'}
									<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
								{:else if step.status === 'failed'}
									<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
								{:else if step.status === 'running'}
									<svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
								{:else}
									{i + 1}
								{/if}
							</span>
							<div class="flex-1 min-w-0">
								<p class="text-sm font-medium
									{step.status === 'done' ? 'text-[var(--accent-green)]' :
									 step.status === 'running' ? 'text-[var(--accent-blue)]' :
									 step.status === 'failed' ? 'text-[var(--accent-red)]' :
									 'text-[var(--text-secondary)]'}">
									{step.label}
									{#if step.status === 'running'}<span class="text-xs opacity-60 ml-1">running...</span>{/if}
								</p>
								{#if step.result?.error}<p class="text-xs text-[var(--accent-red)] truncate">{step.result.error}</p>{/if}
							</div>
							{#if step.status === 'done' && step.result}<span class="text-xs text-[var(--text-secondary)]">OK</span>{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<!-- ═══════════ Live Prices + Spread (compact, 3s refresh) ═══════════ -->
	{#if livePrices.length > 0}
		<div class="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl px-3 py-2">
			<div class="flex items-center justify-between mb-1.5">
				<div class="flex items-center gap-1.5">
					<span class="w-1.5 h-1.5 rounded-full bg-[var(--accent-green)] animate-pulse"></span>
					<h2 class="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Live Prices</h2>
				</div>
				<span class="text-[9px] text-[var(--text-secondary)]">
					{livePrices[0]?.timestamp ? timeAgo(livePrices[0].timestamp) : ''} &middot; 3s
				</span>
			</div>
			<div class="flex flex-wrap gap-2">
				{#each livePrices as p}
					<div class="flex items-center gap-2 bg-[var(--bg-secondary)] rounded-md px-2.5 py-1.5 min-w-0">
						<span class="text-xs font-bold text-white whitespace-nowrap">{p.symbol}</span>
						<span class="text-[10px] font-mono text-[var(--accent-yellow)]">${formatPrice(p.binance_price)}</span>
						<span class="text-[10px] font-mono text-[var(--accent-purple)]">${formatPrice(p.hl_price)}</span>
						<span class="text-[9px] px-1 py-px rounded font-medium whitespace-nowrap
							{Math.abs(p.spread_pct) > 0.1
								? 'bg-[var(--accent-red)]/15 text-[var(--accent-red)]'
								: Math.abs(p.spread_pct) > 0.05
								? 'bg-[var(--accent-yellow)]/15 text-[var(--accent-yellow)]'
								: 'bg-[var(--accent-green)]/15 text-[var(--accent-green)]'
							}">
							{p.spread_pct >= 0 ? '+' : ''}{p.spread_pct.toFixed(3)}%
						</span>
					</div>
				{/each}
			</div>
		</div>
	{/if}

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

		<!-- 내 입금 지갑 주소 -->
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

	<!-- Middle Row: Positions + Signals (10s refresh) -->
	<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
		<!-- Open Positions -->
		<div class="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4">
			<h2 class="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">Open Positions</h2>
			{#if dashboard.openPositions.length > 0}
				<div class="space-y-2">
					{#each dashboard.openPositions as pos}
						<div class="flex items-center justify-between py-2 px-3 rounded-lg bg-[var(--bg-secondary)]">
							<div class="flex items-center gap-3">
								<span class="font-medium">{pos.symbol}</span>
								<span class="px-2 py-0.5 rounded text-xs font-medium {pos.side === 'LONG' ? 'bg-[var(--accent-green)]/15 text-[var(--accent-green)]' : 'bg-[var(--accent-red)]/15 text-[var(--accent-red)]'}">{pos.side}</span>
							</div>
							<div class="text-right">
								<p class="text-sm font-mono">${pos.entry_price.toLocaleString()}</p>
								<p class="text-xs text-[var(--text-secondary)]">{pos.size.toFixed(4)} @ {pos.leverage}x</p>
							</div>
						</div>
					{/each}
				</div>
			{:else}
				<p class="text-[var(--text-secondary)] text-sm py-4 text-center">No open positions</p>
			{/if}
		</div>

		<!-- Current Signals -->
		<div class="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4">
			<h2 class="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">Latest Signals</h2>
			{#if signals?.signals}
				<div class="space-y-3">
					{#each signals.signals as sig}
						<div class="flex items-center justify-between py-2 px-3 rounded-lg bg-[var(--bg-secondary)]">
							<div class="flex items-center gap-3">
								<span class="font-medium">{sig.symbol}</span>
								<SignalBadge action={sig.action} confidence={sig.confidence} />
							</div>
							<div class="text-right text-sm">
								<p class="font-mono">${sig.entry_price.toLocaleString()}</p>
								<p class="text-xs text-[var(--text-secondary)]">Score: {sig.analysis?.composite_score?.toFixed(3) ?? '-'}</p>
							</div>
						</div>
					{/each}
				</div>
				<p class="text-xs text-[var(--text-secondary)] mt-2">Generated: {new Date(signals.generated_at).toLocaleTimeString('ko-KR')}</p>
			{:else}
				<p class="text-[var(--text-secondary)] text-sm py-4 text-center">No signals available</p>
			{/if}
		</div>
	</div>

	<!-- Price Charts (60s refresh) -->
	{#if chartData.BTC && chartData.BTC.length > 0}
		<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
			<PriceChart symbol="BTC" data={chartData.BTC} />
			{#if chartData.ETH && chartData.ETH.length > 0}
				<PriceChart symbol="ETH" data={chartData.ETH} />
			{/if}
		</div>
	{/if}

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

	<!-- Recent Trades (10s refresh) -->
	<div class="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4">
		<div class="flex items-center justify-between mb-3">
			<h2 class="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Recent Trades</h2>
			<a href="/trades" class="text-xs text-[var(--accent-blue)] hover:underline">View all</a>
		</div>
		<TradesTable trades={dashboard.recentTrades} compact />
	</div>

	<!-- Refresh Info -->
	<div class="text-center text-[10px] text-[var(--text-secondary)] py-1">
		Prices: 3s &middot; Dashboard: 10s &middot; Charts: 60s &middot; Binance quota-safe (DB read only)
	</div>
</div>
