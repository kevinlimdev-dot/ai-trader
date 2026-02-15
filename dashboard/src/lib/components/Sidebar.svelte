<script lang="ts">
	import { page } from '$app/state';
	import type { WalletAddresses } from '$lib/types';

	interface Props {
		mode?: string;
		walletAddresses?: WalletAddresses | null;
	}
	let { mode = 'paper', walletAddresses = null }: Props = $props();
	let copied = $state('');

	const nav = [
		{ href: '/', label: 'Dashboard', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
		{ href: '/positions', label: 'Positions', icon: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6' },
		{ href: '/trades', label: 'Trades', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
		{ href: '/signals', label: 'Signals', icon: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z' },
		{ href: '/wallet', label: 'Wallet', icon: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z' },
		{ href: '/control', label: 'Control', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
	];

	function truncateAddr(addr: string) {
		if (addr.length <= 14) return addr;
		return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
	}

	async function copyAddr(addr: string, id: string) {
		try {
			await navigator.clipboard.writeText(addr);
			copied = id;
			setTimeout(() => { copied = ''; }, 2000);
		} catch { /* ignore */ }
	}
</script>

<aside class="w-56 bg-[var(--bg-secondary)] border-r border-[var(--border)] flex flex-col h-screen sticky top-0">
	<div class="p-4 border-b border-[var(--border)]">
		<div class="flex items-center justify-between">
			<h1 class="text-lg font-bold text-white">AI Trader</h1>
			<span class="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase
				{mode === 'live'
					? 'bg-[var(--accent-red)]/20 text-[var(--accent-red)]'
					: 'bg-[var(--accent-yellow)]/20 text-[var(--accent-yellow)]'
				}">
				{mode}
			</span>
		</div>
		<p class="text-xs text-[var(--text-secondary)] mt-0.5">Trading Dashboard</p>
	</div>
	<nav class="flex-1 p-2 space-y-0.5">
		{#each nav as item}
			{@const active = page.url.pathname === item.href || (item.href !== '/' && page.url.pathname.startsWith(item.href))}
			<a
				href={item.href}
				class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors {active ? 'bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'}"
			>
				<svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d={item.icon} />
				</svg>
				{item.label}
			</a>
		{/each}
	</nav>
	{#if mode === 'live'}
		<div class="mx-2 mb-2 px-3 py-2 rounded-lg bg-[var(--accent-red)]/10 border border-[var(--accent-red)]/20">
			<div class="flex items-center gap-2">
				<span class="w-2 h-2 rounded-full bg-[var(--accent-red)] animate-pulse"></span>
				<span class="text-xs font-medium text-[var(--accent-red)]">LIVE TRADING</span>
			</div>
			<p class="text-[10px] text-[var(--text-secondary)] mt-0.5">Real orders active</p>
		</div>
	{/if}

	<!-- 내 입금 지갑 주소 -->
	<div class="mx-2 mb-2 px-3 py-2.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border)]">
		<div class="flex items-center gap-1.5 mb-2">
			<svg class="w-3.5 h-3.5 text-[var(--accent-green)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
			</svg>
			<span class="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">내 지갑</span>
		</div>

		{#if walletAddresses?.hyperliquid}
			<div class="mb-1.5">
				<p class="text-[10px] text-[var(--accent-purple)] font-medium mb-0.5">HyperLiquid</p>
				<button
					onclick={() => walletAddresses?.hyperliquid && copyAddr(walletAddresses.hyperliquid.address, 'hl')}
					class="flex items-center gap-1 w-full group cursor-pointer"
					title={walletAddresses.hyperliquid.address}
				>
					<code class="text-[10px] font-mono text-[var(--text-primary)] bg-[var(--bg-secondary)] px-1.5 py-0.5 rounded truncate flex-1 text-left group-hover:bg-[var(--bg-hover)] transition-colors">
						{truncateAddr(walletAddresses.hyperliquid.address)}
					</code>
					{#if copied === 'hl'}
						<svg class="w-3 h-3 text-[var(--accent-green)] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
					{:else}
						<svg class="w-3 h-3 text-[var(--text-secondary)] flex-shrink-0 opacity-50 group-hover:opacity-100" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
					{/if}
				</button>
			</div>
		{/if}

		{#if walletAddresses?.coinbase?.address}
			<div>
				<p class="text-[10px] text-[var(--accent-blue)] font-medium mb-0.5">Coinbase</p>
				<button
					onclick={() => walletAddresses?.coinbase?.address && copyAddr(walletAddresses.coinbase.address, 'cb')}
					class="flex items-center gap-1 w-full group cursor-pointer"
					title={walletAddresses.coinbase.address}
				>
					<code class="text-[10px] font-mono text-[var(--text-primary)] bg-[var(--bg-secondary)] px-1.5 py-0.5 rounded truncate flex-1 text-left group-hover:bg-[var(--bg-hover)] transition-colors">
						{truncateAddr(walletAddresses.coinbase.address)}
					</code>
					{#if copied === 'cb'}
						<svg class="w-3 h-3 text-[var(--accent-green)] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
					{:else}
						<svg class="w-3 h-3 text-[var(--text-secondary)] flex-shrink-0 opacity-50 group-hover:opacity-100" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
					{/if}
				</button>
			</div>
		{/if}
	</div>

	<div class="p-3 border-t border-[var(--border)] text-xs text-[var(--text-secondary)]">
		v1.0 &middot; Svelte 5
	</div>
</aside>
