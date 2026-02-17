<script lang="ts">
	import SignalBadge from '$lib/components/SignalBadge.svelte';
	import type { BotResult } from '$lib/types';

	let { data } = $props();
	let signals = $state(data.signals);
	let snapshots = $state(data.snapshots);
	let running = $state(false);
	let result: BotResult | null = $state(null);
	let expandedSignal: string | null = $state(null);
	let showHold = $state(false);
	let aiAdjustment: any = $state(null);

	$effect(() => {
		const interval = setInterval(async () => {
			try {
				const [sRes, aRes] = await Promise.all([
					fetch('/api/signals'),
					fetch('/api/ai-adjustments'),
				]);
				const d = await sRes.json();
				signals = d.signals;
				snapshots = d.snapshots;
				if (aRes.ok) aiAdjustment = await aRes.json();
			} catch {}
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

	function formatPrice(price: number): string {
		if (price >= 1000) return price.toLocaleString(undefined, { maximumFractionDigits: 0 });
		if (price >= 1) return price.toLocaleString(undefined, { maximumFractionDigits: 2 });
		return price.toLocaleString(undefined, { maximumFractionDigits: 4 });
	}

	function timeAgo(isoStr: string): string {
		const diff = Date.now() - new Date(isoStr).getTime();
		const sec = Math.floor(diff / 1000);
		if (sec < 60) return `${sec}초 전`;
		const min = Math.floor(sec / 60);
		if (min < 60) return `${min}분 전`;
		const hr = Math.floor(min / 60);
		return `${hr}시간 ${min % 60}분 전`;
	}

	let activeSignals = $derived(signals?.signals?.filter((s: any) => s.action !== 'HOLD') ?? []);
	let holdSignals = $derived(signals?.signals?.filter((s: any) => s.action === 'HOLD') ?? []);
	let longCount = $derived(activeSignals.filter((s: any) => s.action === 'LONG').length);
	let shortCount = $derived(activeSignals.filter((s: any) => s.action === 'SHORT').length);
</script>

<svelte:head><title>AI Trader - Signals</title></svelte:head>

<div class="space-y-4">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<div class="flex items-center gap-3">
			<h1 class="text-xl font-bold">Analysis & Signals</h1>
			{#if signals?.generated_at}
				<span class="text-[10px] text-[var(--text-secondary)]">{timeAgo(signals.generated_at)}</span>
			{/if}
			{#if signals?.signals}
				<span class="text-[10px] px-2 py-0.5 rounded bg-[var(--accent-green)]/15 text-[var(--accent-green)] font-medium">LONG {longCount}</span>
				<span class="text-[10px] px-2 py-0.5 rounded bg-[var(--accent-red)]/15 text-[var(--accent-red)] font-medium">SHORT {shortCount}</span>
				<span class="text-[10px] px-2 py-0.5 rounded bg-[var(--border)]/50 text-[var(--text-secondary)] font-medium">HOLD {holdSignals.length}</span>
			{/if}
		</div>
		<button
			onclick={runAnalysis}
			disabled={running}
			class="px-4 py-2 bg-[var(--accent-blue)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer"
		>
			{running ? '분석 중...' : '분석 실행'}
		</button>
	</div>

	{#if result}
		<div class="p-3 rounded-lg text-sm {result.success ? 'bg-[var(--accent-green)]/10 border border-[var(--accent-green)]/30 text-[var(--accent-green)]' : 'bg-[var(--accent-red)]/10 border border-[var(--accent-red)]/30 text-[var(--accent-red)]'}">
			{result.success ? '분석 완료.' : `오류: ${result.error}`}
		</div>
	{/if}

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
						<span class="text-[9px] px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] text-[var(--text-secondary)]">{aiAdjustment.market_condition}</span>
					{/if}
				</div>
				{#if aiAdjustment.timestamp}
					<span class="text-[9px] text-[var(--text-secondary)]">{timeAgo(aiAdjustment.timestamp)}</span>
				{/if}
			</div>
			<p class="text-[10px] text-[var(--text-secondary)] mb-2">{aiAdjustment.reason}</p>
			{#if aiAdjustment.adjustments}
				<div class="flex flex-wrap gap-2">
					{#each Object.entries(aiAdjustment.adjustments) as [key, val]}
						{@const v = val as { from: number; to: number }}
						<div class="flex items-center gap-1 text-[10px] bg-[var(--bg-secondary)] rounded px-2 py-1">
							<span class="text-[var(--text-secondary)]">{key}</span>
							<span class="font-mono text-[var(--accent-red)] line-through">{v.from}</span>
							<span class="text-[var(--text-secondary)]">→</span>
							<span class="font-mono text-[var(--accent-green)] font-bold">{v.to}</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Active Signals (LONG / SHORT) -->
	{#if activeSignals.length > 0}
		<div class="space-y-2">
			{#each activeSignals as sig}
				<div class="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl overflow-hidden">
					<button
						onclick={() => expandedSignal = expandedSignal === sig.symbol ? null : sig.symbol}
						class="w-full flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-[var(--border)]/10 transition-colors"
					>
						<div class="flex items-center gap-3">
							<span class="text-base font-bold">{sig.symbol}</span>
							<SignalBadge action={sig.action} confidence={sig.confidence} />
							<span class="text-[10px] font-mono text-[var(--text-secondary)]">Score: {sig.analysis?.composite_score?.toFixed(3) ?? '-'}</span>
						</div>
						<div class="flex items-center gap-4">
							<div class="text-right">
								<span class="text-sm font-mono">${formatPrice(sig.entry_price)}</span>
								{#if sig.stop_loss && sig.take_profit}
									<span class="text-[9px] text-[var(--text-secondary)] ml-2">
										SL <span class="text-[var(--accent-red)]">${formatPrice(sig.stop_loss)}</span> /
										TP <span class="text-[var(--accent-green)]">${formatPrice(sig.take_profit)}</span>
									</span>
								{/if}
							</div>
							<svg class="w-4 h-4 text-[var(--text-secondary)] transition-transform {expandedSignal === sig.symbol ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
							</svg>
						</div>
					</button>

					{#if expandedSignal === sig.symbol}
						<div class="border-t border-[var(--border)] px-4 py-4 space-y-4">
							<!-- Composite Score Bar -->
							{#if sig.analysis?.composite_score !== undefined}
								<div>
									<div class="flex items-center justify-between mb-1">
										<span class="text-[10px] text-[var(--text-secondary)] uppercase">Composite Score</span>
										<span class="text-sm font-bold font-mono">{sig.analysis.composite_score.toFixed(4)}</span>
									</div>
									<div class="w-full h-2.5 bg-[var(--bg-secondary)] rounded-full overflow-hidden relative">
										<div class="absolute left-1/2 w-0.5 h-full bg-[var(--border)]"></div>
										<div class="h-full rounded-full transition-all {scoreColor(sig.analysis.composite_score)}" style="width: {scoreBarWidth(sig.analysis.composite_score)}%"></div>
									</div>
									<div class="flex justify-between text-[9px] text-[var(--text-secondary)] mt-0.5">
										<span>-1 (Short)</span><span>0</span><span>+1 (Long)</span>
									</div>
								</div>
							{/if}

							<!-- Indicators -->
							<div class="grid grid-cols-5 gap-2">
								{#if sig.analysis?.spread}
									<div class="bg-[var(--bg-secondary)] rounded-lg p-2.5 text-center">
										<p class="text-[9px] text-[var(--text-secondary)] uppercase mb-1">Spread</p>
										<p class="font-mono text-xs font-bold {indicatorColor(sig.analysis.spread.signal)}">{sig.analysis.spread.signal}</p>
										<p class="text-[9px] text-[var(--text-secondary)]">{(sig.analysis.spread.value_pct * 100).toFixed(3)}%</p>
									</div>
								{/if}
								{#if sig.analysis?.rsi}
									<div class="bg-[var(--bg-secondary)] rounded-lg p-2.5 text-center">
										<p class="text-[9px] text-[var(--text-secondary)] uppercase mb-1">RSI</p>
										<p class="font-mono text-xs font-bold {indicatorColor(sig.analysis.rsi.signal)}">{sig.analysis.rsi.signal}</p>
										<p class="text-[9px] text-[var(--text-secondary)]">{sig.analysis.rsi.value?.toFixed(1)}</p>
									</div>
								{/if}
								{#if sig.analysis?.macd}
									<div class="bg-[var(--bg-secondary)] rounded-lg p-2.5 text-center">
										<p class="text-[9px] text-[var(--text-secondary)] uppercase mb-1">MACD</p>
										<p class="font-mono text-xs font-bold {indicatorColor(sig.analysis.macd.signal)}">{sig.analysis.macd.signal}</p>
										<p class="text-[9px] text-[var(--text-secondary)]">H: {sig.analysis.macd.histogram?.toFixed(2)}</p>
									</div>
								{/if}
								{#if sig.analysis?.bollinger}
									<div class="bg-[var(--bg-secondary)] rounded-lg p-2.5 text-center">
										<p class="text-[9px] text-[var(--text-secondary)] uppercase mb-1">BB</p>
										<p class="font-mono text-xs font-bold {indicatorColor(sig.analysis.bollinger.signal)}">{sig.analysis.bollinger.signal}</p>
										<p class="text-[9px] text-[var(--text-secondary)]">{sig.analysis.bollinger.position}</p>
									</div>
								{/if}
								{#if sig.analysis?.ma}
									<div class="bg-[var(--bg-secondary)] rounded-lg p-2.5 text-center">
										<p class="text-[9px] text-[var(--text-secondary)] uppercase mb-1">MA</p>
										<p class="font-mono text-xs font-bold {indicatorColor(sig.analysis.ma.signal)}">{sig.analysis.ma.signal}</p>
										<p class="text-[9px] text-[var(--text-secondary)]">{sig.analysis.ma.ma_7?.toFixed(0)}/{sig.analysis.ma.ma_25?.toFixed(0)}</p>
									</div>
								{/if}
							</div>

							<!-- 시장 심리 (있으면) -->
							{#if sig.analysis?.market_sentiment}
								{@const ms = sig.analysis.market_sentiment}
								<div>
									<p class="text-[10px] text-[var(--text-secondary)] uppercase mb-2 font-semibold">시장 심리</p>
									<div class="grid grid-cols-3 md:grid-cols-6 gap-2">
										{#if ms.crowd_bias}
											<div class="bg-[var(--bg-secondary)] rounded-lg p-2 text-center">
												<p class="text-[8px] text-[var(--text-secondary)] uppercase">Crowd</p>
												<p class="text-[10px] font-bold {ms.crowd_bias.includes('long') ? 'text-[var(--accent-green)]' : ms.crowd_bias.includes('short') ? 'text-[var(--accent-red)]' : 'text-[var(--text-secondary)]'}">{ms.crowd_bias}</p>
											</div>
										{/if}
										{#if ms.smart_money}
											<div class="bg-[var(--bg-secondary)] rounded-lg p-2 text-center">
												<p class="text-[8px] text-[var(--text-secondary)] uppercase">Smart $</p>
												<p class="text-[10px] font-bold {ms.smart_money.includes('long') ? 'text-[var(--accent-green)]' : ms.smart_money.includes('short') ? 'text-[var(--accent-red)]' : 'text-[var(--text-secondary)]'}">{ms.smart_money}</p>
											</div>
										{/if}
										{#if ms.funding_rate !== undefined}
											<div class="bg-[var(--bg-secondary)] rounded-lg p-2 text-center">
												<p class="text-[8px] text-[var(--text-secondary)] uppercase">Funding</p>
												<p class="text-[10px] font-mono font-bold {ms.funding_rate > 0 ? 'text-[var(--accent-green)]' : ms.funding_rate < 0 ? 'text-[var(--accent-red)]' : 'text-[var(--text-secondary)]'}">{(ms.funding_rate * 100).toFixed(4)}%</p>
											</div>
										{/if}
										{#if ms.taker_pressure}
											<div class="bg-[var(--bg-secondary)] rounded-lg p-2 text-center">
												<p class="text-[8px] text-[var(--text-secondary)] uppercase">Taker</p>
												<p class="text-[10px] font-bold">{ms.taker_pressure}</p>
											</div>
										{/if}
										{#if ms.long_short_ratio !== undefined}
											<div class="bg-[var(--bg-secondary)] rounded-lg p-2 text-center">
												<p class="text-[8px] text-[var(--text-secondary)] uppercase">L/S Ratio</p>
												<p class="text-[10px] font-mono font-bold">{ms.long_short_ratio?.toFixed(2)}</p>
											</div>
										{/if}
										{#if ms.open_interest}
											<div class="bg-[var(--bg-secondary)] rounded-lg p-2 text-center">
												<p class="text-[8px] text-[var(--text-secondary)] uppercase">OI</p>
												<p class="text-[10px] font-mono font-bold">{ms.open_interest}</p>
											</div>
										{/if}
									</div>
								</div>
							{/if}

							<!-- 판단 근거 -->
							<div class="pt-2 border-t border-[var(--border)]">
								<p class="text-[10px] text-[var(--text-secondary)]">
									<strong class="text-white">판단:</strong>
									Score <strong class="{sig.analysis?.composite_score > 0 ? 'text-[var(--accent-green)]' : sig.analysis?.composite_score < 0 ? 'text-[var(--accent-red)]' : 'text-white'}">{sig.analysis?.composite_score?.toFixed(3)}</strong>
									{#if sig.action === 'LONG'}→ <strong class="text-[var(--accent-green)]">매수 진입</strong>{:else}→ <strong class="text-[var(--accent-red)]">매도 진입</strong>{/if}
									{#if sig.risk?.atr} | ATR: {sig.risk.atr.toFixed(2)} | R:R: {sig.risk.risk_reward_ratio?.toFixed(1)}{/if}
								</p>
							</div>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{:else if signals?.signals}
		<div class="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-8 text-center">
			<p class="text-[var(--text-secondary)]">모든 코인 HOLD — 진입 조건 미충족</p>
		</div>
	{:else}
		<div class="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-8 text-center">
			<p class="text-[var(--text-secondary)]">시그널 없음 — 분석 실행을 눌러주세요</p>
		</div>
	{/if}

	<!-- HOLD 시그널 (접기/펼치기) -->
	{#if holdSignals.length > 0}
		<div class="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-3">
			<button onclick={() => showHold = !showHold} class="w-full flex items-center justify-between cursor-pointer">
				<span class="text-[10px] text-[var(--text-secondary)] uppercase font-semibold">HOLD ({holdSignals.length}개)</span>
				<svg class="w-3.5 h-3.5 text-[var(--text-secondary)] transition-transform {showHold ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
				</svg>
			</button>
			{#if showHold}
				<div class="flex flex-wrap gap-1 mt-2">
					{#each holdSignals as sig}
						<span class="text-[9px] px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] text-[var(--text-secondary)] font-mono">{sig.symbol} <span class="opacity-50">{sig.analysis?.composite_score?.toFixed(2) ?? ''}</span></span>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>
