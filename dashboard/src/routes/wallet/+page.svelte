<script lang="ts">
	import type { WalletData, WalletAddresses, BotResult } from '$lib/types';

	let { data } = $props();
	let wallet: WalletData = $state(data.wallet as any);
	let walletAddresses: WalletAddresses = $state(data.walletAddresses as any);
	let refreshing = $state(false);
	let result: BotResult | null = $state(null);
	let copiedId = $state('');

	interface HlSpotBalance { coin: string; total: string; hold: string; usdValue: number; }
	interface HlBalanceDetail { perp: number; spot: HlSpotBalance[]; spotTotalUsd: number; totalUsd: number; }
	interface LiveBalance { coinbase: number; hyperliquid: number; total: number; timestamp: string; hlDetail?: HlBalanceDetail; }
	let liveBalances: LiveBalance | null = $state(null);

	interface DepositInfo { status: string; amount?: string; usdcBalance?: string; txHash?: string; arbiscan?: string; error?: string; }
	let depositLoading = $state(false);
	let depositResult: DepositInfo | null = $state(null);
	let depositChecking = $state(false);
	let arbUsdcBalance: string | null = $state(null);

	$effect(() => {
		fetchLive();
		const interval = setInterval(async () => {
			try {
				const [wRes, bRes] = await Promise.all([fetch('/api/wallet'), fetch('/api/balances')]);
				wallet = await wRes.json();
				if (bRes.ok) liveBalances = await bRes.json();
			} catch {}
		}, 10000);
		return () => clearInterval(interval);
	});

	async function fetchLive() {
		try { liveBalances = await (await fetch('/api/balances')).json(); } catch {}
	}

	async function refreshBalance() {
		refreshing = true;
		result = null;
		try {
			const res = await fetch('/api/bot/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ script: 'balance' }) });
			result = await res.json();
			fetchLive();
		} catch (e) { result = { success: false, error: String(e) }; }
		finally { refreshing = false; }
	}

	async function checkArbBalance() {
		depositChecking = true;
		try {
			const res = await fetch('/api/bot/deposit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'check' }) });
			const d = await res.json();
			if (d.status === 'dry_run') arbUsdcBalance = d.usdcBalance || d.amount || null;
		} catch {}
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
				setTimeout(fetchLive, 5000);
				setTimeout(fetchLive, 30000);
				arbUsdcBalance = null;
			}
		} catch (err) { depositResult = { status: 'error', error: err instanceof Error ? err.message : String(err) }; }
		depositLoading = false;
	}

	function formatTime(ts: string | undefined) {
		if (!ts) return '-';
		return new Date(ts).toLocaleString('ko-KR');
	}

	async function copyAddress(addr: string, id: string) {
		try { await navigator.clipboard.writeText(addr); copiedId = id; setTimeout(() => { copiedId = ''; }, 2500); } catch {}
	}
</script>

<svelte:head><title>AI Trader - Wallet</title></svelte:head>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<h1 class="text-xl font-bold">Wallet</h1>
		<button onclick={refreshBalance} disabled={refreshing} class="px-4 py-2 bg-[var(--accent-blue)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer">
			{refreshing ? '갱신 중...' : '잔고 갱신'}
		</button>
	</div>

	{#if result}
		<div class="p-3 rounded-lg text-sm {result.success ? 'bg-[var(--accent-green)]/10 border border-[var(--accent-green)]/30 text-[var(--accent-green)]' : 'bg-[var(--accent-red)]/10 border border-[var(--accent-red)]/30 text-[var(--accent-red)]'}">
			{result.success ? '잔고 갱신 완료.' : `오류: ${result.error}`}
		</div>
	{/if}

	<!-- 실시간 잔고 -->
	<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
		<div class="box">
			<div class="flex items-center justify-between mb-1">
				<p class="text-[10px] text-[var(--accent-blue)] uppercase tracking-wider font-medium">Coinbase</p>
				{#if liveBalances}<span class="w-1.5 h-1.5 rounded-full bg-[var(--accent-green)] animate-pulse"></span>{/if}
			</div>
			<p class="text-2xl font-bold text-[var(--accent-blue)]">
				{liveBalances ? `$${liveBalances.coinbase.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : wallet.balance ? `$${Number(wallet.balance.coinbase_balance).toFixed(2)}` : 'N/A'}
			</p>
			<p class="text-[10px] text-[var(--text-secondary)]">Base Network</p>
		</div>
		<div class="box">
			<div class="flex items-center justify-between mb-1">
				<p class="text-[10px] text-[var(--accent-purple)] uppercase tracking-wider font-medium">HyperLiquid</p>
				{#if liveBalances}<span class="w-1.5 h-1.5 rounded-full bg-[var(--accent-green)] animate-pulse"></span>{/if}
			</div>
			<p class="text-2xl font-bold text-[var(--accent-purple)]">
				{liveBalances ? `$${liveBalances.hyperliquid.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : wallet.balance ? `$${Number(wallet.balance.hyperliquid_balance).toFixed(2)}` : 'N/A'}
			</p>
			<p class="text-[10px] text-[var(--text-secondary)]">Arbitrum</p>
		</div>
		<div class="box">
			<p class="text-[10px] text-white uppercase tracking-wider font-medium mb-1">Total</p>
			<p class="text-2xl font-bold text-white">
				{liveBalances ? `$${liveBalances.total.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : wallet.balance ? `$${Number(wallet.balance.total_balance).toFixed(2)}` : 'N/A'}
			</p>
			{#if liveBalances}<p class="text-[10px] text-[var(--text-secondary)]">Updated: {new Date(liveBalances.timestamp).toLocaleTimeString('ko-KR')}</p>{/if}
		</div>
	</div>

	<!-- HL 상세 잔고 -->
	{#if liveBalances?.hlDetail && (liveBalances.hlDetail.spot.length > 0 || liveBalances.hlDetail.perp > 0)}
		<div class="box">
			<h2 class="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider font-semibold mb-2">HyperLiquid 상세</h2>
			<div class="space-y-1">
				{#if liveBalances.hlDetail.perp > 0}
					<div class="flex justify-between text-xs"><span class="text-[var(--text-secondary)]">Perp Margin</span><span class="text-[var(--accent-purple)] font-mono">${liveBalances.hlDetail.perp.toFixed(2)}</span></div>
				{/if}
				{#each liveBalances.hlDetail.spot as s}
					<div class="flex justify-between text-xs"><span class="text-[var(--text-secondary)]">{s.coin} <span class="opacity-50">{s.total}</span></span><span class="text-[var(--accent-purple)] font-mono">${s.usdValue.toFixed(2)}</span></div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- 입금 주소 + Arbitrum 자동 입금 -->
	<div class="box !border-[var(--accent-green)]/30">
		<div class="flex items-center gap-2 mb-3">
			<svg class="w-4 h-4 text-[var(--accent-green)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" /></svg>
			<h2 class="text-sm font-semibold uppercase tracking-wider">입금 주소</h2>
		</div>

		{#if walletAddresses?.hyperliquid}
			<div class="bg-[var(--bg-secondary)] rounded-lg p-3 mb-3">
				<div class="flex items-center gap-2 mb-2">
					<span class="w-2.5 h-2.5 rounded-full bg-[var(--accent-purple)]"></span>
					<span class="text-xs font-semibold text-[var(--accent-purple)]">HyperLiquid</span>
					<span class="text-[9px] px-1 py-0.5 rounded bg-[var(--accent-purple)]/15 text-[var(--accent-purple)]">Arbitrum</span>
				</div>
				<div class="flex items-center gap-2">
					<code class="flex-1 text-xs font-mono bg-[var(--bg-card)] px-2.5 py-2 rounded border border-[var(--border)] break-all select-all">{walletAddresses.hyperliquid.address}</code>
					<button onclick={() => walletAddresses?.hyperliquid && copyAddress(walletAddresses.hyperliquid.address, 'hl')} class="flex-shrink-0 p-2 rounded-lg bg-[var(--accent-purple)] text-white hover:opacity-90 cursor-pointer">
						{#if copiedId === 'hl'}<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>{:else}<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>{/if}
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
						<button onclick={executeDeposit} disabled={depositLoading} class="text-[10px] px-3 py-1.5 rounded-lg bg-[var(--accent-green)] text-black font-bold hover:opacity-90 disabled:opacity-50 cursor-pointer disabled:cursor-wait">
							{depositLoading ? '입금 중...' : 'Arbitrum → HL 입금'}
						</button>
					</div>
					{#if depositResult}
						<div class="mt-2 text-[10px] rounded p-2 {depositResult.status === 'success' ? 'bg-[var(--accent-green)]/10 text-[var(--accent-green)]' : 'bg-[var(--accent-red)]/10 text-[var(--accent-red)]'}">
							{#if depositResult.status === 'success'}입금 완료: {depositResult.amount} USDC {#if depositResult.arbiscan}<a href={depositResult.arbiscan} target="_blank" class="underline ml-1">Tx 보기</a>{/if}{:else}오류: {depositResult.error}{/if}
						</div>
					{/if}
				</div>
			</div>
		{/if}

		{#if walletAddresses?.coinbase?.address}
			<div class="bg-[var(--bg-secondary)] rounded-lg p-3">
				<div class="flex items-center gap-2 mb-2">
					<span class="w-2.5 h-2.5 rounded-full bg-[var(--accent-blue)]"></span>
					<span class="text-xs font-semibold text-[var(--accent-blue)]">Coinbase</span>
					<span class="text-[9px] px-1 py-0.5 rounded bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]">Base</span>
				</div>
				<div class="flex items-center gap-2">
					<code class="flex-1 text-xs font-mono bg-[var(--bg-card)] px-2.5 py-2 rounded border border-[var(--border)] break-all select-all">{walletAddresses.coinbase.address}</code>
					<button onclick={() => walletAddresses?.coinbase?.address && copyAddress(walletAddresses.coinbase.address, 'cb')} class="flex-shrink-0 p-2 rounded-lg bg-[var(--accent-blue)] text-white hover:opacity-90 cursor-pointer">
						{#if copiedId === 'cb'}<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>{:else}<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>{/if}
					</button>
				</div>
			</div>
		{/if}
	</div>

	<!-- Balance History -->
	{#if wallet.balanceHistory && wallet.balanceHistory.length > 0}
		<div class="box">
			<h2 class="box-title mb-3">잔고 히스토리</h2>
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead><tr class="text-[var(--text-secondary)] text-xs uppercase border-b border-[var(--border)]"><th class="text-left py-2 px-3">시간</th><th class="text-right py-2 px-3">Coinbase</th><th class="text-right py-2 px-3">HyperLiquid</th><th class="text-right py-2 px-3">Total</th></tr></thead>
					<tbody>
						{#each wallet.balanceHistory.slice(0, 20) as row}
							<tr class="border-b border-[var(--border)]/50">
								<td class="py-2 px-3 text-[var(--text-secondary)] text-xs">{formatTime(row.timestamp)}</td>
								<td class="py-2 px-3 text-right font-mono">${Number(row.coinbase_balance).toFixed(2)}</td>
								<td class="py-2 px-3 text-right font-mono">${Number(row.hyperliquid_balance).toFixed(2)}</td>
								<td class="py-2 px-3 text-right font-mono font-medium">${Number(row.total_balance).toFixed(2)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	{/if}

	<!-- Transfers -->
	<div class="box">
		<h2 class="box-title mb-3">전송 히스토리</h2>
		{#if wallet.transfers && wallet.transfers.length > 0}
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead><tr class="text-[var(--text-secondary)] text-xs uppercase border-b border-[var(--border)]"><th class="text-left py-2 px-3">시간</th><th class="text-left py-2 px-3">유형</th><th class="text-right py-2 px-3">금액</th><th class="text-left py-2 px-3">상태</th><th class="text-left py-2 px-3">TX</th></tr></thead>
					<tbody>
						{#each wallet.transfers as tx}
							<tr class="border-b border-[var(--border)]/50">
								<td class="py-2 px-3 text-[var(--text-secondary)] text-xs">{formatTime(tx.timestamp)}</td>
								<td class="py-2 px-3"><span class="px-2 py-0.5 rounded text-xs font-medium {tx.direction === 'deposit' ? 'bg-[var(--accent-green)]/15 text-[var(--accent-green)]' : 'bg-[var(--accent-red)]/15 text-[var(--accent-red)]'}">{tx.direction}</span></td>
								<td class="py-2 px-3 text-right font-mono">${Number(tx.amount).toFixed(2)}</td>
								<td class="py-2 px-3 text-xs">{tx.status}</td>
								<td class="py-2 px-3 font-mono text-xs text-[var(--text-secondary)]">{tx.tx_hash ? tx.tx_hash.slice(0, 10) + '...' : '-'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<p class="text-[var(--text-secondary)] text-sm py-4 text-center">전송 기록 없음</p>
		{/if}
	</div>
</div>
