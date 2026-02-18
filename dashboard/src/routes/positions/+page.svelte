<script lang="ts">
	import type { TradeRow, BotResult } from '$lib/types';

	let { data } = $props();
	let positions: TradeRow[] = $state(data.positions as any);
	let mode = $state(data.mode);
	let closing = $state(false);
	let closeResult: BotResult | null = $state(null);

	// Polling
	$effect(() => {
		const interval = setInterval(async () => {
			try {
				const res = await fetch('/api/positions');
				const d = await res.json();
				positions = d.positions;
			} catch { /* ignore */ }
		}, 3000);
		return () => clearInterval(interval);
	});

	async function closeAll() {
		if (!confirm('Are you sure you want to close ALL positions?')) return;
		closing = true;
		closeResult = null;
		try {
			const res = await fetch('/api/bot/close-all', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ reason: 'dashboard-manual' }),
			});
			closeResult = await res.json();
			// Refresh positions
			const posRes = await fetch('/api/positions');
			positions = (await posRes.json()).positions;
		} catch (e) {
			closeResult = { success: false, error: String(e) };
		} finally {
			closing = false;
		}
	}

	function formatTime(ts: string | undefined) {
		if (!ts) return '-';
		return new Date(ts).toLocaleString('ko-KR');
	}

	function calcHoldTime(ts: string): string {
		const ms = Date.now() - new Date(ts).getTime();
		const minutes = Math.floor(ms / 60000);
		if (minutes < 60) return `${minutes}m`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ${minutes % 60}m`;
		return `${Math.floor(hours / 24)}d ${hours % 24}h`;
	}
</script>

<svelte:head><title>AI Trader - Positions</title></svelte:head>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-bold">Open Positions</h1>
			<p class="text-sm text-[var(--text-secondary)]">{positions.length} active position(s) &middot; {mode.toUpperCase()} mode</p>
		</div>
		<button
			onclick={closeAll}
			disabled={closing || positions.length === 0}
			class="px-4 py-2 bg-[var(--accent-red)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-30"
		>
			{closing ? 'Closing...' : 'Close All Positions'}
		</button>
	</div>

	{#if closeResult}
		<div class="p-3 rounded-lg text-sm {closeResult.success ? 'bg-[var(--accent-green)]/10 border border-[var(--accent-green)]/30 text-[var(--accent-green)]' : 'bg-[var(--accent-red)]/10 border border-[var(--accent-red)]/30 text-[var(--accent-red)]'}">
			{closeResult.success ? 'All positions closed successfully.' : `Error: ${closeResult.error}`}
		</div>
	{/if}

	{#if positions.length > 0}
		<div class="grid gap-4">
			{#each positions as pos}
				<div class="box">
					<div class="flex items-start justify-between mb-4">
						<div class="flex items-center gap-3">
							<span class="text-lg font-bold">{pos.symbol}</span>
							<span class="px-2.5 py-1 rounded-lg text-sm font-semibold {pos.side === 'LONG' ? 'bg-[var(--accent-green)]/15 text-[var(--accent-green)]' : 'bg-[var(--accent-red)]/15 text-[var(--accent-red)]'}">{pos.side}</span>
							<span class="px-2 py-0.5 rounded text-xs bg-[var(--accent-purple)]/15 text-[var(--accent-purple)]">{pos.status}</span>
						</div>
						<span class="text-xs text-[var(--text-secondary)]">Held: {calcHoldTime(pos.timestamp_open)}</span>
					</div>

					<div class="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
						<div>
							<p class="text-[var(--text-secondary)] text-xs">Entry Price</p>
							<p class="font-mono font-medium">${Number(pos.entry_price).toLocaleString()}</p>
						</div>
						<div>
							<p class="text-[var(--text-secondary)] text-xs">Size</p>
							<p class="font-mono">{Number(pos.size).toFixed(4)}</p>
						</div>
						<div>
							<p class="text-[var(--text-secondary)] text-xs">Leverage</p>
							<p class="font-mono">{pos.leverage}x</p>
						</div>
						<div>
							<p class="text-[var(--text-secondary)] text-xs">Stop Loss</p>
							<p class="font-mono">{pos.stop_loss ? `$${Number(pos.stop_loss).toLocaleString()}` : '-'}</p>
						</div>
						<div>
							<p class="text-[var(--text-secondary)] text-xs">Take Profit</p>
							<p class="font-mono">{pos.take_profit ? `$${Number(pos.take_profit).toLocaleString()}` : '-'}</p>
						</div>
					</div>

					<div class="mt-4 flex items-center justify-between pt-3 border-t border-[var(--border)]">
						<div class="flex items-center gap-4">
							<div class="text-sm">
								<span class="text-[var(--text-secondary)]">Peak PnL:</span>
								<span class="font-mono">{pos.peak_pnl_pct ? `${Number(pos.peak_pnl_pct).toFixed(2)}%` : '-'}</span>
							</div>
							<div class="text-sm">
								<span class="text-[var(--text-secondary)]">Trailing:</span>
								<span class="{pos.trailing_activated ? 'text-[var(--accent-green)]' : 'text-[var(--text-secondary)]'}">{pos.trailing_activated ? 'Active' : 'Inactive'}</span>
							</div>
						</div>
						<span class="text-xs text-[var(--text-secondary)]">{formatTime(pos.timestamp_open)}</span>
					</div>
				</div>
			{/each}
		</div>
	{:else}
		<div class="box text-center">
			<p class="text-[var(--text-secondary)] text-lg">No open positions</p>
			<p class="text-[var(--text-secondary)] text-sm mt-2">Positions will appear here when the bot opens trades.</p>
		</div>
	{/if}
</div>
