<script lang="ts">
	import SignalBadge from '$lib/components/SignalBadge.svelte';
	import type { BotResult } from '$lib/types';

	let { data } = $props();
	let signals = $state(data.signals);
	let snapshots = $state(data.snapshots);
	let running = $state(false);
	let result: BotResult | null = $state(null);

	// Poll
	$effect(() => {
		const interval = setInterval(async () => {
			try {
				const res = await fetch('/api/signals');
				const d = await res.json();
				signals = d.signals;
				snapshots = d.snapshots;
			} catch { /* ignore */ }
		}, 5000);
		return () => clearInterval(interval);
	});

	async function runAnalysis() {
		running = true;
		result = null;
		try {
			const res = await fetch('/api/bot/run', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ script: 'analyze' }),
			});
			result = await res.json();
			// Refresh signals
			const sRes = await fetch('/api/signals');
			const d = await sRes.json();
			signals = d.signals;
		} catch (e) {
			result = { success: false, error: String(e) };
		} finally {
			running = false;
		}
	}

	function indicatorColor(signal: string): string {
		if (signal === 'LONG' || signal === 'bullish' || signal === 'oversold') return 'text-[var(--accent-green)]';
		if (signal === 'SHORT' || signal === 'bearish' || signal === 'overbought') return 'text-[var(--accent-red)]';
		return 'text-[var(--text-secondary)]';
	}

	function scoreBarWidth(score: number): number {
		return Math.min(Math.max((score + 1) / 2 * 100, 0), 100);
	}

	function scoreColor(score: number): string {
		if (score > 0.3) return 'bg-[var(--accent-green)]';
		if (score < -0.3) return 'bg-[var(--accent-red)]';
		return 'bg-[var(--accent-yellow)]';
	}
</script>

<svelte:head><title>AI Trader - Signals</title></svelte:head>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-bold">Analysis & Signals</h1>
			{#if signals?.generated_at}
				<p class="text-sm text-[var(--text-secondary)]">Last update: {new Date(signals.generated_at).toLocaleString('ko-KR')}</p>
			{/if}
		</div>
		<button
			onclick={runAnalysis}
			disabled={running}
			class="px-4 py-2 bg-[var(--accent-blue)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
		>
			{running ? 'Running...' : 'Run Analysis'}
		</button>
	</div>

	{#if result}
		<div class="p-3 rounded-lg text-sm {result.success ? 'bg-[var(--accent-green)]/10 border border-[var(--accent-green)]/30 text-[var(--accent-green)]' : 'bg-[var(--accent-red)]/10 border border-[var(--accent-red)]/30 text-[var(--accent-red)]'}">
			{result.success ? 'Analysis completed successfully.' : `Error: ${result.error}`}
		</div>
	{/if}

	{#if signals?.signals}
		{#each signals.signals as sig}
			<div class="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5">
				<!-- Header -->
				<div class="flex items-center justify-between mb-5">
					<div class="flex items-center gap-3">
						<span class="text-xl font-bold">{sig.symbol}</span>
						<SignalBadge action={sig.action} confidence={sig.confidence} />
					</div>
					<div class="text-right text-sm">
						<p class="font-mono font-medium">${Number(sig.entry_price).toLocaleString()}</p>
						{#if sig.risk}
							<p class="text-xs text-[var(--text-secondary)]">R:R {sig.risk.risk_reward_ratio?.toFixed(2) || '-'}</p>
						{/if}
					</div>
				</div>

				<!-- Composite Score Bar -->
				{#if sig.analysis?.composite_score !== undefined}
					<div class="mb-5">
						<div class="flex items-center justify-between mb-1.5">
							<span class="text-xs text-[var(--text-secondary)] uppercase tracking-wider">Composite Score</span>
							<span class="text-sm font-bold font-mono">{sig.analysis.composite_score.toFixed(4)}</span>
						</div>
						<div class="w-full h-3 bg-[var(--bg-secondary)] rounded-full overflow-hidden relative">
							<div class="absolute left-1/2 w-0.5 h-full bg-[var(--border)]"></div>
							<div
								class="h-full rounded-full transition-all {scoreColor(sig.analysis.composite_score)}"
								style="width: {scoreBarWidth(sig.analysis.composite_score)}%"
							></div>
						</div>
						<div class="flex justify-between text-xs text-[var(--text-secondary)] mt-1">
							<span>-1 (Short)</span>
							<span>0 (Neutral)</span>
							<span>+1 (Long)</span>
						</div>
					</div>
				{/if}

				<!-- Indicators Grid -->
				<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
					<!-- Spread -->
					{#if sig.analysis?.spread}
						<div class="bg-[var(--bg-secondary)] rounded-lg p-3">
							<p class="text-xs text-[var(--text-secondary)] uppercase mb-1">Spread</p>
							<p class="font-mono text-sm {indicatorColor(sig.analysis.spread.signal)}">{sig.analysis.spread.value_pct?.toFixed(3)}%</p>
							<p class="text-xs mt-0.5">{sig.analysis.spread.direction} &middot; {sig.analysis.spread.signal}</p>
						</div>
					{/if}

					<!-- RSI -->
					{#if sig.analysis?.rsi}
						<div class="bg-[var(--bg-secondary)] rounded-lg p-3">
							<p class="text-xs text-[var(--text-secondary)] uppercase mb-1">RSI</p>
							<p class="font-mono text-sm {indicatorColor(sig.analysis.rsi.signal)}">{sig.analysis.rsi.value?.toFixed(1)}</p>
							<p class="text-xs mt-0.5">{sig.analysis.rsi.signal}</p>
						</div>
					{/if}

					<!-- MACD -->
					{#if sig.analysis?.macd}
						<div class="bg-[var(--bg-secondary)] rounded-lg p-3">
							<p class="text-xs text-[var(--text-secondary)] uppercase mb-1">MACD</p>
							<p class="font-mono text-sm {indicatorColor(sig.analysis.macd.signal)}">{sig.analysis.macd.histogram?.toFixed(2)}</p>
							<p class="text-xs mt-0.5">{sig.analysis.macd.signal}</p>
						</div>
					{/if}

					<!-- Bollinger -->
					{#if sig.analysis?.bollinger}
						<div class="bg-[var(--bg-secondary)] rounded-lg p-3">
							<p class="text-xs text-[var(--text-secondary)] uppercase mb-1">Bollinger</p>
							<p class="font-mono text-sm {indicatorColor(sig.analysis.bollinger.signal)}">{sig.analysis.bollinger.position}</p>
							<p class="text-xs mt-0.5">{sig.analysis.bollinger.signal}</p>
						</div>
					{/if}

					<!-- MA -->
					{#if sig.analysis?.ma}
						<div class="bg-[var(--bg-secondary)] rounded-lg p-3">
							<p class="text-xs text-[var(--text-secondary)] uppercase mb-1">Moving Avg</p>
							<p class="font-mono text-sm {indicatorColor(sig.analysis.ma.signal)}">{sig.analysis.ma.signal}</p>
							<p class="text-xs mt-0.5">7: {sig.analysis.ma.ma_7?.toFixed(0)} / 25: {sig.analysis.ma.ma_25?.toFixed(0)}</p>
						</div>
					{/if}
				</div>

				<!-- SL/TP -->
				{#if sig.stop_loss || sig.take_profit}
					<div class="mt-4 pt-3 border-t border-[var(--border)] flex gap-6 text-sm">
						<div>
							<span class="text-[var(--text-secondary)]">Stop Loss:</span>
							<span class="font-mono text-[var(--accent-red)]">${Number(sig.stop_loss).toLocaleString()}</span>
						</div>
						<div>
							<span class="text-[var(--text-secondary)]">Take Profit:</span>
							<span class="font-mono text-[var(--accent-green)]">${Number(sig.take_profit).toLocaleString()}</span>
						</div>
						{#if sig.risk?.atr}
							<div>
								<span class="text-[var(--text-secondary)]">ATR:</span>
								<span class="font-mono">{sig.risk.atr.toFixed(2)}</span>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		{/each}
	{:else}
		<div class="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-12 text-center">
			<p class="text-[var(--text-secondary)] text-lg">No signals available</p>
			<p class="text-[var(--text-secondary)] text-sm mt-2">Run analysis to generate signals.</p>
		</div>
	{/if}

	<!-- Snapshots Info -->
	{#if snapshots}
		<div class="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4">
			<h2 class="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">Latest Price Snapshot</h2>
			<div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
				{#if Array.isArray(snapshots)}
					{#each snapshots as snap}
						<div class="bg-[var(--bg-secondary)] rounded-lg p-3">
							<p class="font-medium">{snap.symbol}</p>
							<p class="font-mono text-xs">Binance: ${Number(snap.binance_price).toLocaleString()}</p>
							<p class="font-mono text-xs">HyperLiquid: ${Number(snap.hyperliquid_price).toLocaleString()}</p>
							<p class="text-xs text-[var(--text-secondary)] mt-1">Spread: {Number(snap.spread_pct).toFixed(4)}%</p>
						</div>
					{/each}
				{/if}
			</div>
		</div>
	{/if}
</div>
