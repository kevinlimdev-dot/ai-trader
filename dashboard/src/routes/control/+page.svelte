<script lang="ts">
	import type { BotResult, SetupSummary } from '$lib/types';

	let { data } = $props();
	let mode = $state(data.mode);
	let killSwitch = $state(data.killSwitch);
	let apiErrorCount = $state(data.apiErrorCount);
	let configYaml = $state(data.configYaml);
	let setup: SetupSummary = $state(data.setup as any);

	let togglingKs = $state(false);
	let switchingMode = $state(false);
	let runningScript: string | null = $state(null);
	let lastResult: BotResult | null = $state(null);

	// Strategy
	type StrategyName = 'conservative' | 'balanced' | 'aggressive';
	interface StrategyInfo { name: StrategyName; label: string; desc: string; leverage: string; risk: string; maxPos: number; }
	const STRATEGIES: StrategyInfo[] = [
		{ name: 'conservative', label: 'Conservative', desc: '보수적 · 자본 보존', leverage: '5x', risk: '2%', maxPos: 5 },
		{ name: 'balanced', label: 'Balanced', desc: '선별적 진입 · 안정 승률', leverage: '7x', risk: '3%', maxPos: 6 },
		{ name: 'aggressive', label: 'Aggressive', desc: '공격적 · 모멘텀 추종', leverage: '10x', risk: '5%', maxPos: 15 },
	];
	let currentStrategy: StrategyName = $state('balanced');
	let strategyLoading = $state(false);

	// Runner
	interface RunnerStatus { state: string; pid: number; cycleCount: number; successCount: number; failCount: number; lastCycle: any; nextCycleAt: string | null; intervalSec: number; mode: string; updatedAt: string | null; }
	let runnerStatus: RunnerStatus = $state({ state: 'stopped', pid: 0, cycleCount: 0, successCount: 0, failCount: 0, lastCycle: null, nextCycleAt: null, intervalSec: 0, mode: 'unknown', updatedAt: null });
	let runnerLoading = $state(false);

	// Monitor
	interface MonitorStatus { state: string; checkCount: number; closedCount: number; openPositions: number; lastCheckAt: string | null; intervalSec: number; }
	let monitorStatus: MonitorStatus = $state({ state: 'stopped', checkCount: 0, closedCount: 0, openPositions: 0, lastCheckAt: null, intervalSec: 15 });

	// HL Positions
	interface HlPos { coin: string; side: string; size: number; entryPx: number; unrealizedPnl: number; leverage: number; leverageType: string; positionValue: number; returnOnEquity: number; }
	let hlPositions: HlPos[] = $state([]);
	let closingPositions: Set<string> = $state(new Set());

	$effect(() => {
		fetchAll();
		const interval = setInterval(fetchAll, 5000);
		return () => clearInterval(interval);
	});

	async function fetchAll() {
		try {
			const [ksRes, modeRes, setupRes, runRes, monRes, stratRes, dashRes] = await Promise.all([
				fetch('/api/bot/kill-switch'),
				fetch('/api/bot/mode'),
				fetch('/api/setup'),
				fetch('/api/bot/runner'),
				fetch('/api/bot/monitor'),
				fetch('/api/bot/strategy'),
				fetch('/api/dashboard'),
			]);
			killSwitch = (await ksRes.json()).active;
			mode = (await modeRes.json()).mode;
			setup = await setupRes.json();
			if (runRes.ok) runnerStatus = await runRes.json();
			if (monRes.ok) monitorStatus = await monRes.json();
			if (stratRes.ok) { const s = await stratRes.json(); if (s.strategy) currentStrategy = s.strategy; }
			if (dashRes.ok) { const d = await dashRes.json(); if (d.hlPositions) hlPositions = d.hlPositions; }
		} catch {}
	}

	async function toggleKillSwitch() {
		togglingKs = true;
		try { killSwitch = (await (await fetch('/api/bot/kill-switch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !killSwitch }) })).json()).active; } catch {}
		togglingKs = false;
	}

	async function switchMode(newMode: string) {
		if (newMode === 'live' && !confirm('LIVE 모드로 전환하면 실제 거래가 실행됩니다. 계속하시겠습니까?')) return;
		switchingMode = true;
		try {
			const r = await (await fetch('/api/bot/mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: newMode }) })).json();
			if (r.success) mode = r.mode;
		} catch {}
		switchingMode = false;
	}

	async function setStrategy(name: StrategyName) {
		strategyLoading = true;
		try { await fetch('/api/bot/strategy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ strategy: name }) }); currentStrategy = name; } catch {}
		strategyLoading = false;
	}

	async function runScript(script: string) {
		runningScript = script;
		lastResult = null;
		try { lastResult = await (await fetch('/api/bot/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ script }) })).json(); } catch (e) { lastResult = { success: false, error: String(e) }; }
		finally { runningScript = null; }
	}

	async function toggleRunner(action: string) {
		runnerLoading = true;
		try { await fetch('/api/bot/runner', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) }); setTimeout(fetchAll, 1500); } catch {}
		runnerLoading = false;
	}

	async function toggleMonitor() {
		const action = monitorStatus.state === 'running' ? 'stop' : 'start';
		await fetch('/api/bot/monitor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
		setTimeout(fetchAll, 1500);
	}

	async function closePosition(coin: string, side: string) {
		const key = `${coin}-${side}`;
		if (closingPositions.has(key)) return;
		if (!confirm(`${coin} ${side} 포지션을 청산하시겠습니까?`)) return;
		closingPositions = new Set([...closingPositions, key]);
		try {
			const r = await (await fetch('/api/bot/close-position', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ coin, side }) })).json();
			if (!r.success) alert(`청산 실패: ${r.error}`);
			setTimeout(fetchAll, 2000);
		} catch (err) { alert(`오류: ${err instanceof Error ? err.message : String(err)}`); }
		finally { const u = new Set(closingPositions); u.delete(key); closingPositions = u; }
	}

	async function closeAllPositions() {
		if (!confirm('모든 포지션을 청산하시겠습니까?')) return;
		try { await fetch('/api/bot/close-all', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'dashboard_manual' }) }); setTimeout(fetchAll, 2000); } catch {}
	}

	function timeAgo(isoStr: string): string {
		const diff = Date.now() - new Date(isoStr).getTime();
		const sec = Math.floor(diff / 1000);
		if (sec < 60) return `${sec}초 전`;
		const min = Math.floor(sec / 60);
		if (min < 60) return `${min}분 전`;
		return `${Math.floor(min / 60)}시간 ${min % 60}분 전`;
	}

	const scripts = [
		{ id: 'collect', label: '가격 수집', desc: 'Binance + HyperLiquid 시세', color: 'var(--accent-blue)' },
		{ id: 'analyze', label: '분석', desc: '기술적 분석 + 시그널 생성', color: 'var(--accent-purple)' },
		{ id: 'trade', label: '거래 실행', desc: '시그널 기반 주문', color: 'var(--accent-green)' },
		{ id: 'monitor', label: '포지션 체크', desc: 'SL/TP/트레일링 확인', color: 'var(--accent-yellow)' },
		{ id: 'auto-rebalance', label: '자금 리밸런스', desc: '잔고 자동 배분', color: 'var(--accent-blue)' },
		{ id: 'daily-summary', label: '일일 요약', desc: '오늘 거래 결과', color: 'var(--text-secondary)' },
	];

	let runnerActive = $derived(runnerStatus.state === 'running' || runnerStatus.state === 'idle');
</script>

<svelte:head><title>AI Trader - Control</title></svelte:head>

<div class="space-y-4">
	<h1 class="text-xl font-bold">Bot Control</h1>

	<!-- Status Cards -->
	<div class="grid grid-cols-2 md:grid-cols-4 gap-3">
		<!-- Mode -->
		<div class="box">
			<p class="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider mb-2">Trading Mode</p>
			<div class="flex gap-2">
				<button onclick={() => switchMode('paper')} disabled={switchingMode || mode === 'paper'} class="flex-1 px-2 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer {mode === 'paper' ? 'bg-[var(--accent-yellow)]/15 border-[var(--accent-yellow)]/40 text-[var(--accent-yellow)]' : 'bg-[var(--bg-secondary)] border-[var(--border)] text-[var(--text-secondary)] hover:text-white'} disabled:opacity-60">PAPER</button>
				<button onclick={() => switchMode('live')} disabled={switchingMode || mode === 'live'} class="flex-1 px-2 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer {mode === 'live' ? 'bg-[var(--accent-red)]/15 border-[var(--accent-red)]/40 text-[var(--accent-red)]' : 'bg-[var(--bg-secondary)] border-[var(--border)] text-[var(--text-secondary)] hover:text-white'} disabled:opacity-60">LIVE</button>
			</div>
		</div>

		<!-- Kill Switch -->
		<div class="box">
			<p class="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider mb-2">Kill Switch</p>
			<div class="flex items-center gap-3">
				<button onclick={toggleKillSwitch} disabled={togglingKs} aria-label="Toggle Kill Switch" class="relative w-12 h-6 rounded-full transition-colors cursor-pointer {killSwitch ? 'bg-[var(--accent-red)]' : 'bg-gray-600'}">
					<span class="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform {killSwitch ? 'translate-x-6' : 'translate-x-0'}"></span>
				</button>
				<span class="text-xs font-medium {killSwitch ? 'text-[var(--accent-red)]' : 'text-[var(--accent-green)]'}">{killSwitch ? 'ACTIVE' : 'Off'}</span>
			</div>
		</div>

		<!-- API Errors -->
		<div class="box">
			<p class="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider mb-2">API Errors</p>
			<p class="text-xl font-bold {apiErrorCount > 0 ? 'text-[var(--accent-red)]' : 'text-[var(--accent-green)]'}">{apiErrorCount}</p>
		</div>

		<!-- Setup -->
		<div class="box">
			<p class="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider mb-2">Setup</p>
			{#if setup.ok}
				<span class="text-xs font-medium text-[var(--accent-green)] flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-[var(--accent-green)]"></span> All Clear</span>
			{:else}
				<span class="text-xs font-medium text-[var(--accent-red)] flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-[var(--accent-red)]"></span> {setup.errors} Error</span>
			{/if}
			{#if setup.warnings > 0}<p class="text-[10px] text-[var(--accent-yellow)] mt-0.5">{setup.warnings} warning</p>{/if}
		</div>
	</div>

	<!-- Strategy Selection -->
	<div class="box">
		<h2 class="box-title mb-3">전략 선택</h2>
		<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
			{#each STRATEGIES as s}
				<button
					onclick={() => setStrategy(s.name)}
					disabled={strategyLoading}
					class="p-3 rounded-lg border text-left transition-all cursor-pointer
						{currentStrategy === s.name
							? 'bg-[var(--accent-blue)]/10 border-[var(--accent-blue)]/40'
							: 'bg-[var(--bg-secondary)] border-[var(--border)] hover:border-[var(--accent-blue)]/30'
						}"
				>
					<p class="text-sm font-bold {currentStrategy === s.name ? 'text-[var(--accent-blue)]' : 'text-white'}">{s.label}</p>
					<p class="text-[10px] text-[var(--text-secondary)] mt-0.5">{s.desc}</p>
					<div class="flex gap-2 mt-2 text-[9px] text-[var(--text-secondary)]">
						<span>Lev: {s.leverage}</span>
						<span>Risk: {s.risk}</span>
						<span>Max: {s.maxPos}</span>
					</div>
				</button>
			{/each}
		</div>
	</div>

	<!-- Runner + Monitor Control -->
	<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
		<!-- Runner -->
		<div class="box">
			<div class="flex items-center justify-between mb-3">
				<div class="flex items-center gap-2">
					<span class="w-2 h-2 rounded-full {runnerActive ? 'bg-[var(--accent-green)] animate-pulse' : 'bg-[var(--text-secondary)]'}"></span>
					<h2 class="text-sm font-semibold uppercase tracking-wider">자동매매 러너</h2>
				</div>
				<div class="flex gap-2">
					<button onclick={() => toggleRunner('once')} disabled={runnerLoading} class="text-[10px] px-3 py-1.5 rounded-lg bg-[var(--accent-blue)]/15 text-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/25 cursor-pointer disabled:opacity-50">1회 실행</button>
					{#if runnerActive}
						<button onclick={() => toggleRunner('stop')} disabled={runnerLoading} class="text-[10px] px-3 py-1.5 rounded-lg bg-[var(--accent-red)]/15 text-[var(--accent-red)] hover:bg-[var(--accent-red)]/25 cursor-pointer disabled:opacity-50">정지</button>
					{:else}
						<button onclick={() => toggleRunner('start')} disabled={runnerLoading} class="text-[10px] px-3 py-1.5 rounded-lg bg-[var(--accent-green)]/15 text-[var(--accent-green)] hover:bg-[var(--accent-green)]/25 cursor-pointer disabled:opacity-50">자동매매 시작</button>
					{/if}
				</div>
			</div>
			<div class="text-[10px] text-[var(--text-secondary)] space-y-1">
				<p>상태: <span class="font-medium text-white">{runnerStatus.state}</span> · 사이클: {runnerStatus.cycleCount} (성공 {runnerStatus.successCount} / 실패 {runnerStatus.failCount})</p>
				{#if runnerStatus.nextCycleAt}<p>다음 사이클: {timeAgo(runnerStatus.nextCycleAt)}</p>{/if}
			</div>
		</div>

		<!-- Monitor -->
		<div class="box">
			<div class="flex items-center justify-between mb-3">
				<div class="flex items-center gap-2">
					<span class="w-2 h-2 rounded-full {monitorStatus.state === 'running' ? 'bg-[var(--accent-green)] animate-pulse' : 'bg-[var(--text-secondary)]'}"></span>
					<h2 class="text-sm font-semibold uppercase tracking-wider">포지션 모니터</h2>
				</div>
				<button onclick={toggleMonitor} class="text-[10px] px-3 py-1.5 rounded-lg cursor-pointer {monitorStatus.state === 'running' ? 'bg-[var(--accent-red)]/15 text-[var(--accent-red)] hover:bg-[var(--accent-red)]/25' : 'bg-[var(--accent-green)]/15 text-[var(--accent-green)] hover:bg-[var(--accent-green)]/25'}">
					{monitorStatus.state === 'running' ? '정지' : '시작'}
				</button>
			</div>
			<div class="text-[10px] text-[var(--text-secondary)] space-y-1">
				<p>상태: <span class="font-medium text-white">{monitorStatus.state}</span> · {monitorStatus.intervalSec}초 주기</p>
				<p>체크: {monitorStatus.checkCount}회 · 청산: {monitorStatus.closedCount}건 · 포지션: {monitorStatus.openPositions}건</p>
				{#if monitorStatus.lastCheckAt}<p>마지막: {timeAgo(monitorStatus.lastCheckAt)}</p>{/if}
			</div>
		</div>
	</div>

	<!-- Open Positions (청산 가능) -->
	{#if hlPositions.length > 0}
		<div class="box">
			<div class="flex items-center justify-between mb-3">
				<div class="flex items-center gap-2">
					<h2 class="box-title">Open Positions</h2>
					<span class="text-[9px] px-1.5 py-0.5 rounded bg-[var(--accent-blue)]/15 text-[var(--accent-blue)] font-medium">{hlPositions.length}건</span>
				</div>
				<button onclick={closeAllPositions} class="text-[10px] px-3 py-1.5 rounded-lg bg-[var(--accent-red)]/15 text-[var(--accent-red)] hover:bg-[var(--accent-red)]/25 cursor-pointer">전체 청산</button>
			</div>
			<div class="space-y-1.5">
				{#each hlPositions as pos}
					{@const posKey = `${pos.coin}-${pos.side}`}
					{@const pnlPct = pos.returnOnEquity * 100}
					{@const isProfit = pos.unrealizedPnl >= 0}
					<div class="flex items-center justify-between py-2 px-3 rounded-lg bg-[var(--bg-secondary)]">
						<div class="flex items-center gap-2">
							<span class="font-medium text-sm">{pos.coin}</span>
							<span class="px-1.5 py-0.5 rounded text-[10px] font-semibold {pos.side === 'LONG' ? 'bg-[var(--accent-green)]/15 text-[var(--accent-green)]' : 'bg-[var(--accent-red)]/15 text-[var(--accent-red)]'}">{pos.side}</span>
							<span class="text-[10px] text-[var(--text-secondary)]">{pos.leverage}x</span>
						</div>
						<div class="flex items-center gap-3">
							<span class="text-sm font-mono {isProfit ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}">{isProfit ? '+' : ''}{pos.unrealizedPnl.toFixed(2)} <span class="text-[10px]">({isProfit ? '+' : ''}{pnlPct.toFixed(2)}%)</span></span>
							<button onclick={() => closePosition(pos.coin, pos.side)} disabled={closingPositions.has(posKey)} class="px-2 py-1 rounded text-[10px] font-semibold cursor-pointer bg-[var(--accent-red)]/10 text-[var(--accent-red)] hover:bg-[var(--accent-red)]/25 disabled:opacity-40 disabled:cursor-not-allowed">
								{closingPositions.has(posKey) ? '...' : '청산'}
							</button>
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Manual Execution -->
	<div class="box">
		<h2 class="box-title mb-3">수동 실행</h2>
		<div class="grid grid-cols-3 md:grid-cols-6 gap-2">
			{#each scripts as s}
				<button onclick={() => runScript(s.id)} disabled={runningScript !== null} class="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg p-3 text-left hover:bg-[var(--bg-hover)] transition-all disabled:opacity-50 cursor-pointer relative">
					{#if runningScript === s.id}<div class="absolute inset-0 flex items-center justify-center bg-[var(--bg-secondary)]/80 rounded-lg"><span class="text-[10px] text-[var(--text-secondary)] animate-pulse">실행중...</span></div>{/if}
					<p class="text-xs font-medium" style="color: {s.color}">{s.label}</p>
					<p class="text-[9px] text-[var(--text-secondary)] mt-0.5">{s.desc}</p>
				</button>
			{/each}
		</div>
	</div>

	<!-- Results -->
	{#if lastResult}
		<div class="box">
			<div class="flex items-center justify-between mb-2">
				<h2 class="box-title">실행 결과</h2>
				<span class="px-2 py-0.5 rounded text-xs font-medium {lastResult.success ? 'bg-[var(--accent-green)]/15 text-[var(--accent-green)]' : 'bg-[var(--accent-red)]/15 text-[var(--accent-red)]'}">{lastResult.success ? '성공' : '실패'}</span>
			</div>
			<pre class="bg-[var(--bg-primary)] rounded-lg p-3 text-[10px] font-mono overflow-x-auto max-h-64 text-[var(--text-secondary)]">{typeof lastResult.data === 'string' ? lastResult.data : JSON.stringify(lastResult.data, null, 2)}{#if lastResult.error}
Error: {lastResult.error}{/if}</pre>
		</div>
	{/if}

	<!-- Environment Setup -->
	<div class="box">
		<h2 class="box-title mb-3">환경 설정</h2>
		<div class="grid grid-cols-1 md:grid-cols-2 gap-2">
			{#each setup.checks as check}
				<div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-secondary)]">
					{#if check.status === 'ok'}
						<svg class="w-3.5 h-3.5 text-[var(--accent-green)] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
					{:else if check.status === 'error'}
						<svg class="w-3.5 h-3.5 text-[var(--accent-red)] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
					{:else}
						<svg class="w-3.5 h-3.5 text-[var(--accent-yellow)] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
					{/if}
					<div class="flex-1 min-w-0">
						<p class="text-xs font-medium {check.status === 'ok' ? '' : check.status === 'error' ? 'text-[var(--accent-red)]' : 'text-[var(--accent-yellow)]'}">{check.label}</p>
						<p class="text-[10px] text-[var(--text-secondary)] truncate">{check.message}</p>
					</div>
				</div>
			{/each}
		</div>
	</div>

	<!-- Config -->
	<details class="box !p-0">
		<summary class="px-4 py-3 box-title cursor-pointer hover:text-white">config.yaml</summary>
		<div class="px-4 pb-4">
			<pre class="bg-[var(--bg-primary)] rounded-lg p-3 text-[10px] font-mono overflow-x-auto max-h-64 text-[var(--text-secondary)]">{configYaml}</pre>
		</div>
	</details>
</div>
