<script lang="ts">
	import type { TradeRow } from '$lib/types';

	interface Props {
		trades: TradeRow[];
		compact?: boolean;
	}

	let { trades, compact = false }: Props = $props();

	function formatTime(ts: string | undefined) {
		if (!ts) return '-';
		return new Date(ts).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
	}

	function formatPnl(pnl: number | undefined) {
		if (pnl === undefined || pnl === null) return '-';
		const sign = pnl >= 0 ? '+' : '';
		return `${sign}$${pnl.toFixed(2)}`;
	}
</script>

<div class="overflow-x-auto">
	<table class="w-full text-sm">
		<thead>
			<tr class="text-[var(--text-secondary)] text-xs uppercase border-b border-[var(--border)]">
				<th class="text-left py-2 px-3">Time</th>
				<th class="text-left py-2 px-3">Symbol</th>
				<th class="text-left py-2 px-3">Side</th>
				<th class="text-right py-2 px-3">Entry</th>
				{#if !compact}
					<th class="text-right py-2 px-3">Exit</th>
					<th class="text-right py-2 px-3">Size</th>
				{/if}
				<th class="text-right py-2 px-3">PnL</th>
				<th class="text-left py-2 px-3">Status</th>
			</tr>
		</thead>
		<tbody>
			{#each trades as trade}
				<tr class="border-b border-[var(--border)]/50 hover:bg-[var(--bg-hover)] transition-colors">
					<td class="py-2 px-3 text-[var(--text-secondary)]">{formatTime(trade.timestamp_open)}</td>
					<td class="py-2 px-3 font-medium">{trade.symbol}</td>
					<td class="py-2 px-3">
						<span class="px-2 py-0.5 rounded text-xs font-medium {trade.side === 'LONG' ? 'bg-[var(--accent-green)]/15 text-[var(--accent-green)]' : 'bg-[var(--accent-red)]/15 text-[var(--accent-red)]'}">
							{trade.side}
						</span>
					</td>
					<td class="py-2 px-3 text-right font-mono">${trade.entry_price.toLocaleString()}</td>
					{#if !compact}
						<td class="py-2 px-3 text-right font-mono">{trade.exit_price ? `$${trade.exit_price.toLocaleString()}` : '-'}</td>
						<td class="py-2 px-3 text-right font-mono">{trade.size.toFixed(4)}</td>
					{/if}
					<td class="py-2 px-3 text-right font-mono {(trade.pnl ?? 0) >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}">
						{formatPnl(trade.pnl)}
					</td>
					<td class="py-2 px-3">
						<span class="px-2 py-0.5 rounded text-xs {trade.status === 'closed' ? 'bg-gray-700 text-gray-300' : trade.status === 'paper' ? 'bg-[var(--accent-purple)]/15 text-[var(--accent-purple)]' : 'bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]'}">
							{trade.status}
						</span>
					</td>
				</tr>
			{:else}
				<tr><td colspan={compact ? 5 : 7} class="py-8 text-center text-[var(--text-secondary)]">No trades</td></tr>
			{/each}
		</tbody>
	</table>
</div>
