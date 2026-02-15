<script lang="ts">
	import type { WalletData, WalletAddresses, BotResult } from '$lib/types';

	let { data } = $props();
	let wallet: WalletData = $state(data.wallet as any);
	let walletAddresses: WalletAddresses = $state(data.walletAddresses as any);
	let refreshing = $state(false);
	let result: BotResult | null = $state(null);
	let copiedId = $state('');

	// Poll
	$effect(() => {
		const interval = setInterval(async () => {
			try {
				const res = await fetch('/api/wallet');
				wallet = await res.json();
			} catch { /* ignore */ }
		}, 10000);
		return () => clearInterval(interval);
	});

	async function refreshBalance() {
		refreshing = true;
		result = null;
		try {
			const res = await fetch('/api/bot/run', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ script: 'balance' }),
			});
			result = await res.json();
			const wRes = await fetch('/api/wallet');
			wallet = await wRes.json();
		} catch (e) {
			result = { success: false, error: String(e) };
		} finally {
			refreshing = false;
		}
	}

	function formatTime(ts: string | undefined) {
		if (!ts) return '-';
		return new Date(ts).toLocaleString('ko-KR');
	}

	async function copyAddress(addr: string, id: string) {
		try {
			await navigator.clipboard.writeText(addr);
			copiedId = id;
			setTimeout(() => { copiedId = ''; }, 2500);
		} catch { /* ignore */ }
	}
</script>

<svelte:head><title>AI Trader - Wallet</title></svelte:head>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold">Wallet</h1>
		<button
			onclick={refreshBalance}
			disabled={refreshing}
			class="px-4 py-2 bg-[var(--accent-blue)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
		>
			{refreshing ? 'Refreshing...' : 'Refresh Balance'}
		</button>
	</div>

	{#if result}
		<div class="p-3 rounded-lg text-sm {result.success ? 'bg-[var(--accent-green)]/10 border border-[var(--accent-green)]/30 text-[var(--accent-green)]' : 'bg-[var(--accent-red)]/10 border border-[var(--accent-red)]/30 text-[var(--accent-red)]'}">
			{result.success ? 'Balance refreshed.' : `Error: ${result.error}`}
		</div>
	{/if}

	<!-- Single Deposit Address -->
	<div class="bg-[var(--bg-card)] border border-[var(--accent-green)]/30 rounded-xl p-5">
		<div class="flex items-center gap-2 mb-4">
			<svg class="w-5 h-5 text-[var(--accent-green)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
			</svg>
			<h2 class="text-sm font-semibold text-[var(--text-primary)] uppercase tracking-wider">입금 주소</h2>
			<span class="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-green)]/15 text-[var(--accent-green)] font-medium">단일 입금 포인트</span>
		</div>

		<!-- Primary deposit: Coinbase Agentic Wallet -->
		<div class="bg-[var(--bg-secondary)] rounded-lg p-5 border-2 border-[var(--accent-blue)]/30 mb-4">
			<div class="flex items-center gap-2 mb-3">
				<span class="w-3 h-3 rounded-full bg-[var(--accent-blue)]"></span>
				<span class="text-base font-bold text-[var(--accent-blue)]">Coinbase Agentic Wallet</span>
				<span class="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]">Base Network</span>
			</div>

			{#if walletAddresses?.coinbase?.address}
				<div class="flex items-center gap-3 mt-3">
					<code class="flex-1 text-base font-mono text-[var(--text-primary)] bg-[var(--bg-card)] px-4 py-3 rounded-lg border border-[var(--border)] break-all select-all">
						{walletAddresses.coinbase.address}
					</code>
					<button
						onclick={() => walletAddresses?.coinbase?.address && copyAddress(walletAddresses.coinbase.address, 'cb_wallet')}
						class="flex-shrink-0 px-4 py-3 rounded-lg bg-[var(--accent-blue)] text-white font-medium text-sm hover:opacity-90 transition-opacity cursor-pointer flex items-center gap-2"
						title="주소 복사"
					>
						{#if copiedId === 'cb_wallet'}
							<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
							복사됨
						{:else}
							<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
							복사
						{/if}
					</button>
				</div>
			{:else}
				<div class="mt-3 px-4 py-3 rounded-lg bg-[var(--bg-card)] border border-[var(--border)]">
					<p class="text-sm text-[var(--text-secondary)]">터미널에서 확인:</p>
					<code class="block text-sm font-mono text-[var(--accent-blue)] mt-1 select-all">bunx awal address</code>
				</div>
			{/if}

			<div class="mt-3 p-3 rounded-lg bg-[var(--accent-green)]/5 border border-[var(--accent-green)]/20">
				<p class="text-xs text-[var(--accent-green)] font-medium">
					이 주소로 USDC를 입금하세요. 봇이 HyperLiquid 거래에 필요한 자금을 자동으로 배분합니다.
				</p>
			</div>
		</div>

		<!-- Auto-distribution flow -->
		<div class="bg-[var(--bg-secondary)] rounded-lg p-4 border border-[var(--border)]">
			<h3 class="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">자동 자금 배분 흐름</h3>
			<div class="flex items-center gap-2 text-xs">
				<div class="flex-1 text-center px-3 py-2 rounded bg-[var(--accent-blue)]/10 border border-[var(--accent-blue)]/20">
					<p class="font-semibold text-[var(--accent-blue)]">Coinbase</p>
					<p class="text-[10px] text-[var(--text-secondary)]">Base 네트워크</p>
					<p class="text-[10px] text-[var(--text-secondary)]">USDC 입금</p>
				</div>
				<div class="flex flex-col items-center gap-0.5 text-[var(--text-secondary)]">
					<svg class="w-5 h-5 text-[var(--accent-yellow)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
					<span class="text-[9px]">자동</span>
				</div>
				<div class="flex-1 text-center px-3 py-2 rounded bg-[var(--accent-purple)]/10 border border-[var(--accent-purple)]/20">
					<p class="font-semibold text-[var(--accent-purple)]">HyperLiquid</p>
					<p class="text-[10px] text-[var(--text-secondary)]">Arbitrum</p>
					<p class="text-[10px] text-[var(--text-secondary)]">거래 실행</p>
				</div>
			</div>
			<p class="text-[10px] text-[var(--text-secondary)] mt-2 text-center">
				거래 전 잔고 확인 → 부족 시 자동 충전 / 과다 시 자동 회수
			</p>
		</div>
	</div>

	<!-- Balances -->
	<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
		<div class="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5">
			<p class="text-xs text-[var(--text-secondary)] uppercase tracking-wider mb-1">Coinbase (Base)</p>
			<p class="text-2xl font-bold text-[var(--accent-blue)]">
				{wallet.balance ? `$${Number(wallet.balance.coinbase_balance).toFixed(2)}` : 'N/A'}
			</p>
		</div>
		<div class="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5">
			<p class="text-xs text-[var(--text-secondary)] uppercase tracking-wider mb-1">HyperLiquid (Arbitrum)</p>
			<p class="text-2xl font-bold text-[var(--accent-purple)]">
				{wallet.balance ? `$${Number(wallet.balance.hyperliquid_balance).toFixed(2)}` : 'N/A'}
			</p>
		</div>
		<div class="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5">
			<p class="text-xs text-[var(--text-secondary)] uppercase tracking-wider mb-1">Total Balance</p>
			<p class="text-2xl font-bold text-white">
				{wallet.balance ? `$${Number(wallet.balance.total_balance).toFixed(2)}` : 'N/A'}
			</p>
			{#if wallet.balance?.timestamp}
				<p class="text-xs text-[var(--text-secondary)] mt-1">Updated: {formatTime(wallet.balance.timestamp)}</p>
			{/if}
		</div>
	</div>

	<!-- Balance History -->
	{#if wallet.balanceHistory && wallet.balanceHistory.length > 0}
		<div class="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4">
			<h2 class="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">Balance History</h2>
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead>
						<tr class="text-[var(--text-secondary)] text-xs uppercase border-b border-[var(--border)]">
							<th class="text-left py-2 px-3">Time</th>
							<th class="text-right py-2 px-3">Coinbase</th>
							<th class="text-right py-2 px-3">HyperLiquid</th>
							<th class="text-right py-2 px-3">Total</th>
						</tr>
					</thead>
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
	<div class="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4">
		<h2 class="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">Transfer History</h2>
		{#if wallet.transfers && wallet.transfers.length > 0}
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead>
						<tr class="text-[var(--text-secondary)] text-xs uppercase border-b border-[var(--border)]">
							<th class="text-left py-2 px-3">Time</th>
							<th class="text-left py-2 px-3">Direction</th>
							<th class="text-right py-2 px-3">Amount</th>
							<th class="text-left py-2 px-3">Currency</th>
							<th class="text-left py-2 px-3">Status</th>
							<th class="text-left py-2 px-3">TX Hash</th>
						</tr>
					</thead>
					<tbody>
						{#each wallet.transfers as tx}
							<tr class="border-b border-[var(--border)]/50">
								<td class="py-2 px-3 text-[var(--text-secondary)] text-xs">{formatTime(tx.timestamp)}</td>
								<td class="py-2 px-3">
									<span class="px-2 py-0.5 rounded text-xs font-medium {tx.direction === 'deposit' ? 'bg-[var(--accent-green)]/15 text-[var(--accent-green)]' : 'bg-[var(--accent-red)]/15 text-[var(--accent-red)]'}">{tx.direction}</span>
								</td>
								<td class="py-2 px-3 text-right font-mono">${Number(tx.amount).toFixed(2)}</td>
								<td class="py-2 px-3">{tx.currency}</td>
								<td class="py-2 px-3 text-xs">{tx.status}</td>
								<td class="py-2 px-3 font-mono text-xs text-[var(--text-secondary)]">{tx.tx_hash ? tx.tx_hash.slice(0, 10) + '...' : '-'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<p class="text-[var(--text-secondary)] text-sm py-4 text-center">No transfers recorded</p>
		{/if}
	</div>
</div>
