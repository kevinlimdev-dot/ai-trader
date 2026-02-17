<script lang="ts">
	import type { TradeRow, TradesResponse } from '$lib/types';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	let { data } = $props();
	let tradesData: TradesResponse = $derived(data.tradesData as any);

	let selectedTrade: TradeRow | null = $state(null);
	let filterSymbol = $state(data.filters.symbol || '');
	let filterSide = $state(data.filters.side || '');
	let filterStatus = $state(data.filters.status || '');

	function applyFilters() {
		const params = new URLSearchParams();
		if (filterSymbol) params.set('symbol', filterSymbol);
		if (filterSide) params.set('side', filterSide);
		if (filterStatus) params.set('status', filterStatus);
		goto(`/trades?${params.toString()}`);
	}

	function clearFilters() {
		filterSymbol = '';
		filterSide = '';
		filterStatus = '';
		goto('/trades');
	}

	function goPage(p: number) {
		const params = new URLSearchParams(page.url.searchParams);
		params.set('page', String(p));
		goto(`/trades?${params.toString()}`);
	}

	function formatTime(ts: string | undefined) {
		if (!ts) return '-';
		return new Date(ts).toLocaleString('ko-KR');
	}

	function formatPnl(pnl: number | undefined) {
		if (pnl === undefined || pnl === null) return '-';
		const sign = pnl >= 0 ? '+' : '';
		return `${sign}$${pnl.toFixed(2)}`;
	}
</script>

<svelte:head><title>AI Trader - Trades</title></svelte:head>

<div class="space-y-6">
	<h1 class="text-2xl font-bold">Trade History</h1>

	<!-- Filters -->
	<div class="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4">
		<div class="flex flex-wrap gap-3 items-end">
			<div>
				<label class="block text-xs text-[var(--text-secondary)] mb-1">Symbol</label>
				<input bind:value={filterSymbol} placeholder="e.g. BTC" class="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm text-white w-32 focus:outline-none focus:border-[var(--accent-blue)]" />
			</div>
			<div>
				<label class="block text-xs text-[var(--text-secondary)] mb-1">Side</label>
				<select bind:value={filterSide} class="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm text-white w-28 focus:outline-none focus:border-[var(--accent-blue)]">
					<option value="">All</option>
					<option value="LONG">LONG</option>
					<option value="SHORT">SHORT</option>
				</select>
			</div>
			<div>
				<label class="block text-xs text-[var(--text-secondary)] mb-1">Status</label>
				<select bind:value={filterStatus} class="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm text-white w-28 focus:outline-none focus:border-[var(--accent-blue)]">
					<option value="">All</option>
					<option value="open">Open</option>
					<option value="closed">Closed</option>
					<option value="paper">Paper</option>
				</select>
			</div>
			<button onclick={applyFilters} class="px-4 py-1.5 bg-[var(--accent-blue)] text-white rounded-lg text-sm hover:opacity-90 transition-opacity">Filter</button>
			<button onclick={clearFilters} class="px-4 py-1.5 bg-[var(--bg-hover)] text-[var(--text-secondary)] rounded-lg text-sm hover:text-white transition-colors">Clear</button>
		</div>
	</div>

	<!-- Table -->
	<div class="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl overflow-hidden">
		<table class="w-full text-sm">
			<thead>
				<tr class="text-[var(--text-secondary)] text-xs uppercase border-b border-[var(--border)] bg-[var(--bg-secondary)]">
					<th class="text-left py-3 px-4">Time</th>
					<th class="text-left py-3 px-4">Symbol</th>
					<th class="text-left py-3 px-4">Side</th>
					<th class="text-right py-3 px-4">Entry</th>
					<th class="text-right py-3 px-4">Exit</th>
					<th class="text-right py-3 px-4">Size</th>
					<th class="text-right py-3 px-4">PnL</th>
					<th class="text-right py-3 px-4">Fees</th>
					<th class="text-left py-3 px-4">Exit Reason</th>
					<th class="text-left py-3 px-4">Status</th>
				</tr>
			</thead>
			<tbody>
				{#each tradesData.trades as trade}
					<tr
						class="border-b border-[var(--border)]/50 hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
						onclick={() => selectedTrade = selectedTrade?.id === trade.id ? null : trade}
					>
						<td class="py-2.5 px-4 text-[var(--text-secondary)] text-xs">{formatTime(trade.timestamp_open)}</td>
						<td class="py-2.5 px-4 font-medium">{trade.symbol}</td>
						<td class="py-2.5 px-4">
							<span class="px-2 py-0.5 rounded text-xs font-medium {trade.side === 'LONG' ? 'bg-[var(--accent-green)]/15 text-[var(--accent-green)]' : 'bg-[var(--accent-red)]/15 text-[var(--accent-red)]'}">{trade.side}</span>
						</td>
						<td class="py-2.5 px-4 text-right font-mono">${Number(trade.entry_price).toLocaleString()}</td>
						<td class="py-2.5 px-4 text-right font-mono">{trade.exit_price ? `$${Number(trade.exit_price).toLocaleString()}` : '-'}</td>
						<td class="py-2.5 px-4 text-right font-mono">{Number(trade.size).toFixed(4)}</td>
						<td class="py-2.5 px-4 text-right font-mono {(trade.pnl ?? 0) >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}">{formatPnl(trade.pnl)}</td>
						<td class="py-2.5 px-4 text-right font-mono text-[var(--text-secondary)]">{trade.fees ? `$${Number(trade.fees).toFixed(2)}` : '-'}</td>
						<td class="py-2.5 px-4 text-xs text-[var(--text-secondary)]">{trade.exit_reason || '-'}</td>
						<td class="py-2.5 px-4">
							<span class="px-2 py-0.5 rounded text-xs {trade.status === 'closed' ? 'bg-gray-700 text-gray-300' : trade.status === 'paper' ? 'bg-[var(--accent-purple)]/15 text-[var(--accent-purple)]' : 'bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]'}">{trade.status}</span>
						</td>
					</tr>
					{#if selectedTrade?.id === trade.id}
						<tr class="bg-[var(--bg-secondary)]">
							<td colspan="10" class="p-4">
								<div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
									<div><span class="text-[var(--text-secondary)]">Trade ID:</span> <span class="font-mono text-xs">{trade.trade_id}</span></div>
									<div><span class="text-[var(--text-secondary)]">Leverage:</span> {trade.leverage}x</div>
									<div><span class="text-[var(--text-secondary)]">Stop Loss:</span> {trade.stop_loss ? `$${Number(trade.stop_loss).toLocaleString()}` : '-'}</div>
									<div><span class="text-[var(--text-secondary)]">Take Profit:</span> {trade.take_profit ? `$${Number(trade.take_profit).toLocaleString()}` : '-'}</div>
									<div><span class="text-[var(--text-secondary)]">Peak PnL%:</span> {trade.peak_pnl_pct ? `${Number(trade.peak_pnl_pct).toFixed(2)}%` : '-'}</div>
									<div><span class="text-[var(--text-secondary)]">Trailing:</span> {trade.trailing_activated ? 'Active' : 'Inactive'}</div>
									<div><span class="text-[var(--text-secondary)]">Confidence:</span> {trade.signal_confidence ? `${(Number(trade.signal_confidence) * 100).toFixed(0)}%` : '-'}</div>
									<div><span class="text-[var(--text-secondary)]">Closed:</span> {formatTime(trade.timestamp_close)}</div>
								</div>
							</td>
						</tr>
					{/if}
				{:else}
					<tr><td colspan="10" class="py-12 text-center text-[var(--text-secondary)]">No trades found</td></tr>
				{/each}
			</tbody>
		</table>
	</div>

	<!-- Pagination -->
	{#if tradesData.totalPages > 1}
		<div class="flex items-center justify-between">
			<p class="text-sm text-[var(--text-secondary)]">
				Showing {(tradesData.page - 1) * tradesData.limit + 1} - {Math.min(tradesData.page * tradesData.limit, tradesData.total)} of {tradesData.total}
			</p>
			<div class="flex gap-1">
				<button
					onclick={() => goPage(tradesData.page - 1)}
					disabled={tradesData.page <= 1}
					class="px-3 py-1.5 rounded-lg text-sm bg-[var(--bg-card)] border border-[var(--border)] disabled:opacity-30 hover:bg-[var(--bg-hover)] transition-colors"
				>Prev</button>
				{#each Array.from({ length: Math.min(tradesData.totalPages, 5) }, (_, i) => i + Math.max(1, tradesData.page - 2)) as p}
					{#if p <= tradesData.totalPages}
						<button
							onclick={() => goPage(p)}
							class="px-3 py-1.5 rounded-lg text-sm border transition-colors {p === tradesData.page ? 'bg-[var(--accent-blue)] border-[var(--accent-blue)] text-white' : 'bg-[var(--bg-card)] border-[var(--border)] hover:bg-[var(--bg-hover)]'}"
						>{p}</button>
					{/if}
				{/each}
				<button
					onclick={() => goPage(tradesData.page + 1)}
					disabled={tradesData.page >= tradesData.totalPages}
					class="px-3 py-1.5 rounded-lg text-sm bg-[var(--bg-card)] border border-[var(--border)] disabled:opacity-30 hover:bg-[var(--bg-hover)] transition-colors"
				>Next</button>
			</div>
		</div>
	{/if}
</div>
