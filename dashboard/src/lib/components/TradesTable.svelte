<script lang="ts">
	import type { TradeRow, LivePrice } from '$lib/types';

	interface Props {
		trades: TradeRow[];
		compact?: boolean;
		mini?: boolean;
		livePrices?: LivePrice[];
		onSymbolClick?: (symbol: string) => void;
	}

	let { trades, compact = false, mini = false, livePrices = [], onSymbolClick }: Props = $props();

	function formatTime(ts: string | undefined) {
		if (!ts) return '-';
		if (mini) {
			return new Date(ts).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
		}
		return new Date(ts).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
	}

	function formatPnl(pnl: number | undefined) {
		if (pnl === undefined || pnl === null) return '-';
		const sign = pnl >= 0 ? '+' : '';
		return `${sign}$${pnl.toFixed(2)}`;
	}

	function formatPrice(price: number) {
		if (price >= 1000) return price.toLocaleString(undefined, { maximumFractionDigits: 0 });
		if (price >= 1) return price.toLocaleString(undefined, { maximumFractionDigits: 2 });
		return price.toLocaleString(undefined, { maximumFractionDigits: 4 });
	}

	function getCurrentPrice(symbol: string): number | null {
		const p = livePrices.find(lp => lp.symbol === symbol);
		return p ? p.hl_price : null;
	}

	function getCloseDistance(trade: TradeRow): { slPct: number; tpPct: number; progress: number; nearSl: boolean } | null {
		const isOpen = trade.status === 'open' || trade.status === 'paper';
		if (!isOpen) return null;
		const cur = getCurrentPrice(trade.symbol);
		if (!cur || !trade.stop_loss || !trade.take_profit) return null;

		const sl = trade.stop_loss;
		const tp = trade.take_profit;
		const entry = trade.entry_price;
		const isLong = trade.side === 'LONG';

		const slDist = isLong ? ((cur - sl) / (entry - sl)) : ((sl - cur) / (sl - entry));
		const tpDist = isLong ? ((tp - cur) / (tp - entry)) : ((cur - tp) / (entry - tp));

		const slPct = isLong ? ((cur - sl) / cur * 100) : ((sl - cur) / cur * 100);
		const tpPct = isLong ? ((tp - cur) / cur * 100) : ((cur - tp) / cur * 100);

		const totalRange = Math.abs(tp - sl);
		const curPos = isLong ? (cur - sl) / totalRange : (sl - cur) / totalRange;
		const progress = Math.max(0, Math.min(1, curPos));

		return { slPct, tpPct, progress, nearSl: slPct < 0.5 };
	}

	function getWinProbability(trade: TradeRow): { pct: number; label: string; color: string } | null {
		const isOpen = trade.status === 'open' || trade.status === 'paper';

		if (!isOpen) {
			if (trade.status === 'closed') {
				const won = (trade.pnl ?? 0) > 0;
				return { pct: won ? 100 : 0, label: won ? 'W' : 'L', color: won ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]' };
			}
			return null;
		}

		const dist = getCloseDistance(trade);
		if (!dist) return null;

		const confidence = trade.signal_confidence ?? 0.3;

		// progress: SL(0) ~ TP(1) 사이 현재 위치
		// 진입 시점 entry는 보통 0.3~0.5 사이 (R:R에 따라)
		// progress가 0.5 이상이면 TP 쪽으로 이동 중 → 유리
		const positionScore = dist.progress;

		// 방향 모멘텀: 현재가가 진입가보다 유리한 방향이면 보너스
		const cur = getCurrentPrice(trade.symbol);
		let momentumBonus = 0;
		if (cur) {
			const isLong = trade.side === 'LONG';
			const priceMoveDir = isLong ? (cur - trade.entry_price) : (trade.entry_price - cur);
			momentumBonus = priceMoveDir > 0 ? 0.1 : -0.05;
		}

		// 복합 확률: 위치(50%) + 신뢰도(30%) + 기본(10%) + 모멘텀(10%)
		const rawProb = positionScore * 0.50 + confidence * 0.30 + 0.10 + momentumBonus;
		const pct = Math.max(5, Math.min(95, Math.round(rawProb * 100)));

		let color: string;
		if (pct >= 65) color = 'text-[var(--accent-green)]';
		else if (pct >= 45) color = 'text-[var(--accent-yellow)]';
		else color = 'text-[var(--accent-red)]';

		return { pct, label: `${pct}%`, color };
	}

	const showCompact = $derived(compact || mini);
	const cellPy = $derived(mini ? 'py-0.5' : 'py-2');
	const cellPx = $derived(mini ? 'px-1.5' : 'px-3');
	const fontSize = $derived(mini ? 'text-[10px]' : 'text-sm');
	const headSize = $derived(mini ? 'text-[9px]' : 'text-xs');
	const hasLivePrices = $derived(livePrices.length > 0);
</script>

<div class="overflow-x-auto">
	<table class="w-full {fontSize}">
		<thead class="sticky top-0 bg-black z-10">
			<tr class="text-[var(--text-secondary)] {headSize} uppercase border-b border-[var(--border)]">
				<th class="text-left {cellPy} {cellPx}">Time</th>
				<th class="text-left {cellPy} {cellPx}">Sym</th>
				<th class="text-left {cellPy} {cellPx}">Side</th>
				<th class="text-right {cellPy} {cellPx}">Entry</th>
				{#if hasLivePrices}
					<th class="text-right {cellPy} {cellPx}">Now</th>
					<th class="text-center {cellPy} {cellPx}">SL / TP</th>
				{/if}
				{#if !showCompact}
					<th class="text-right {cellPy} {cellPx}">Exit</th>
					<th class="text-right {cellPy} {cellPx}">Size</th>
				{/if}
				<th class="text-right {cellPy} {cellPx}">PnL</th>
				{#if hasLivePrices}
					<th class="text-center {cellPy} {cellPx}">Win%</th>
				{/if}
				<th class="text-left {cellPy} {cellPx}">St</th>
			</tr>
		</thead>
		<tbody>
			{#each trades as trade}
				<tr class="border-b border-[var(--border)]/50 hover:bg-[var(--bg-hover)] transition-colors">
					<td class="{cellPy} {cellPx} text-[var(--text-secondary)] whitespace-nowrap">{formatTime(trade.timestamp_open)}</td>
					<td class="{cellPy} {cellPx} font-medium">
						{#if onSymbolClick}
							<button onclick={() => onSymbolClick?.(trade.symbol)} class="hover:text-[var(--accent-blue)] hover:underline cursor-pointer transition-colors">{trade.symbol}</button>
						{:else}
							{trade.symbol}
						{/if}
					</td>
					<td class="{cellPy} {cellPx}">
						{#if mini}
							<span class="{trade.side === 'LONG' ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'} font-medium">
								{trade.side === 'LONG' ? 'L' : 'S'}
							</span>
						{:else}
							<span class="px-2 py-0.5 rounded text-xs font-medium {trade.side === 'LONG' ? 'bg-[var(--accent-green)]/15 text-[var(--accent-green)]' : 'bg-[var(--accent-red)]/15 text-[var(--accent-red)]'}">
								{trade.side}
							</span>
						{/if}
					</td>
				<td class="{cellPy} {cellPx} text-right font-mono">${formatPrice(trade.entry_price)}</td>
				{#if hasLivePrices}
					{@const curPrice = getCurrentPrice(trade.symbol)}
					{@const dist = getCloseDistance(trade)}
					<td class="{cellPy} {cellPx} text-right font-mono">
						{#if curPrice && (trade.status === 'open' || trade.status === 'paper')}
							{@const priceDiff = ((curPrice - trade.entry_price) / trade.entry_price * 100) * (trade.side === 'LONG' ? 1 : -1)}
							<span class="{priceDiff >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}">
								${formatPrice(curPrice)}
							</span>
						{:else if trade.exit_price}
							<span class="text-[var(--text-secondary)]">${formatPrice(trade.exit_price)}</span>
						{:else}
							<span class="text-[var(--text-secondary)]">-</span>
						{/if}
					</td>
					<td class="{cellPy} {cellPx}">
						{#if dist && trade.stop_loss && trade.take_profit}
							<div class="flex flex-col items-center gap-0.5 min-w-[70px]" title="SL: ${formatPrice(trade.stop_loss)} (-{dist.slPct.toFixed(1)}%) / TP: ${formatPrice(trade.take_profit)} (+{dist.tpPct.toFixed(1)}%)">
								<div class="w-full h-1.5 rounded-full bg-[var(--bg-secondary)] overflow-hidden relative">
									<div class="absolute left-0 top-0 h-full bg-gradient-to-r from-[var(--accent-red)] via-[var(--accent-yellow)] to-[var(--accent-green)] rounded-full opacity-30 w-full"></div>
									<div
										class="absolute top-0 h-full w-1 rounded-full {dist.nearSl ? 'bg-[var(--accent-red)]' : 'bg-white'} shadow-sm"
										style="left: calc({dist.progress * 100}% - 2px)"
									></div>
								</div>
								{#if mini}
									<div class="flex justify-between w-full text-[7px] font-mono leading-none">
										<span class="text-[var(--accent-red)]">${formatPrice(trade.stop_loss)}</span>
										<span class="text-[var(--accent-green)]">${formatPrice(trade.take_profit)}</span>
									</div>
									<div class="flex justify-between w-full text-[7px] font-mono leading-none opacity-60">
										<span class="text-[var(--accent-red)]">-{dist.slPct.toFixed(1)}%</span>
										<span class="text-[var(--accent-green)]">+{dist.tpPct.toFixed(1)}%</span>
									</div>
								{:else}
									<div class="flex justify-between w-full text-[9px] font-mono leading-none">
										<span class="text-[var(--accent-red)]">${formatPrice(trade.stop_loss)}</span>
										<span class="text-[var(--accent-green)]">${formatPrice(trade.take_profit)}</span>
									</div>
									<div class="flex justify-between w-full text-[8px] font-mono leading-none opacity-60">
										<span class="text-[var(--accent-red)]">SL -{dist.slPct.toFixed(1)}%</span>
										<span class="text-[var(--accent-green)]">TP +{dist.tpPct.toFixed(1)}%</span>
									</div>
								{/if}
							</div>
						{:else if trade.status === 'closed' && trade.exit_reason}
							<span class="text-[var(--text-secondary)] {mini ? 'text-[8px]' : 'text-[10px]'}">{trade.exit_reason}</span>
						{:else}
							<span class="text-[var(--text-secondary)]">-</span>
						{/if}
					</td>
				{/if}
				{#if !showCompact}
					<td class="{cellPy} {cellPx} text-right font-mono">{trade.exit_price ? `$${formatPrice(trade.exit_price)}` : '-'}</td>
					<td class="{cellPy} {cellPx} text-right font-mono">{trade.size.toFixed(4)}</td>
				{/if}
				<td class="{cellPy} {cellPx} text-right font-mono {(trade.pnl ?? 0) >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}">
					{formatPnl(trade.pnl)}
				</td>
				{#if hasLivePrices}
					{@const winProb = getWinProbability(trade)}
					<td class="{cellPy} {cellPx} text-center">
						{#if winProb}
							{#if trade.status === 'closed'}
								<span class="font-bold {winProb.color} {mini ? 'text-[9px]' : 'text-xs'}">
									{winProb.label}
								</span>
							{:else}
								<div class="flex flex-col items-center gap-0.5">
									<div class="relative {mini ? 'w-5 h-5' : 'w-6 h-6'}">
										<svg class="w-full h-full -rotate-90" viewBox="0 0 36 36">
											<circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--bg-secondary)" stroke-width="3" />
											<circle cx="18" cy="18" r="15.5" fill="none"
												stroke={winProb.pct >= 65 ? 'var(--accent-green)' : winProb.pct >= 45 ? 'var(--accent-yellow)' : 'var(--accent-red)'}
												stroke-width="3"
												stroke-dasharray="{winProb.pct * 0.9742} 97.42"
												stroke-linecap="round"
											/>
										</svg>
										<span class="absolute inset-0 flex items-center justify-center font-bold {winProb.color} {mini ? 'text-[7px]' : 'text-[8px]'}">
											{winProb.pct}
										</span>
									</div>
								</div>
							{/if}
						{:else}
							<span class="text-[var(--text-secondary)]">-</span>
						{/if}
					</td>
				{/if}
					<td class="{cellPy} {cellPx}">
						{#if mini}
							<span class="w-1.5 h-1.5 rounded-full inline-block {trade.status === 'closed' ? 'bg-gray-500' : trade.status === 'paper' ? 'bg-[var(--accent-purple)]' : 'bg-[var(--accent-blue)]'}" title={trade.status}></span>
						{:else}
							<span class="px-2 py-0.5 rounded text-xs {trade.status === 'closed' ? 'bg-gray-700 text-gray-300' : trade.status === 'paper' ? 'bg-[var(--accent-purple)]/15 text-[var(--accent-purple)]' : 'bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]'}">
								{trade.status}
							</span>
						{/if}
					</td>
				</tr>
			{:else}
				<tr><td colspan={showCompact ? (hasLivePrices ? 8 : 5) : (hasLivePrices ? 10 : 7)} class="text-center"><div class="flex items-center justify-center min-h-[120px]"><span class="text-xs text-[var(--text-secondary)]">거래 내역 없음</span></div></td></tr>
			{/each}
		</tbody>
	</table>
</div>
