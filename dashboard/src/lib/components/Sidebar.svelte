<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import type { WalletAddresses, SetupSummary } from '$lib/types';
	import { isPrivate, togglePrivacy, maskAddr } from '$lib/privacy.svelte';

	interface Props {
		mode?: string;
		walletAddresses?: WalletAddresses | null;
		setup?: SetupSummary | null;
		open?: boolean;
		switchingMode?: boolean;
		onclose?: () => void;
		ontogglemode?: () => void;
	}
	let { mode = 'paper', walletAddresses = null, setup = null, open = false, switchingMode = false, onclose, ontogglemode }: Props = $props();
	let copied = $state('');
	let showWarnings = $state(false);

	interface OpenClawInfo { installed: boolean; daemonRunning: boolean }
	let openclawInfo: OpenClawInfo = $state({ installed: false, daemonRunning: false });
	const openclawReady = $derived(openclawInfo.installed && openclawInfo.daemonRunning);

	$effect(() => {
		async function fetchOpenClaw() {
			try {
				const res = await fetch('/api/bot/openclaw');
				const data = await res.json();
				if (data.openclaw) openclawInfo = data.openclaw;
			} catch { /* ignore */ }
		}
		fetchOpenClaw();
		const interval = setInterval(fetchOpenClaw, 15000);
		return () => clearInterval(interval);
	});

	const hasIssues = $derived(setup ? (setup.errors > 0 || setup.warnings > 0) : false);
	const errorChecks = $derived(setup?.checks.filter(c => c.status === 'error') ?? []);
	const warningChecks = $derived(setup?.checks.filter(c => c.status === 'warning') ?? []);
	const okChecks = $derived(setup?.checks.filter(c => c.status === 'ok') ?? []);

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

	function handleNav(href: string) {
		goto(href);
		onclose?.();
	}
</script>

<!-- Mobile overlay -->
{#if open}
	<button
		class="fixed inset-0 bg-black/60 z-40 lg:hidden backdrop-blur-sm"
		onclick={onclose}
		aria-label="Close menu"
	></button>
{/if}

<!-- Warnings modal -->
{#if showWarnings}
	<div class="fixed inset-0 z-[60] flex items-center justify-center p-4">
		<button class="absolute inset-0 bg-black/70 backdrop-blur-sm" onclick={() => showWarnings = false} aria-label="Close"></button>
		<div class="relative bg-[var(--bg-secondary)] border border-[#333] rounded-[10px] w-full max-w-lg max-h-[80vh] overflow-y-auto shadow-2xl">
			<div class="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] sticky top-0 bg-[var(--bg-secondary)]">
				<h3 class="text-sm font-semibold text-white">Setup Status</h3>
				<button onclick={() => showWarnings = false} class="text-[var(--text-secondary)] hover:text-white cursor-pointer" aria-label="Close">
					<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>
			<div class="p-4 space-y-2">
				{#each errorChecks as check}
					<div class="flex items-start gap-3 px-3 py-2 rounded-lg bg-[var(--accent-red)]/8 border border-[var(--accent-red)]/20">
						<span class="mt-0.5 w-2 h-2 rounded-full bg-[var(--accent-red)] flex-shrink-0"></span>
						<div>
							<p class="text-sm font-medium text-[var(--accent-red)]">{check.label}</p>
							<p class="text-xs text-[var(--text-secondary)]">{check.message}</p>
						</div>
					</div>
				{/each}
				{#each warningChecks as check}
					<div class="flex items-start gap-3 px-3 py-2 rounded-lg bg-[var(--accent-yellow)]/8 border border-[var(--accent-yellow)]/15">
						<span class="mt-0.5 w-2 h-2 rounded-full bg-[var(--accent-yellow)] flex-shrink-0"></span>
						<div>
							<p class="text-sm font-medium text-[var(--accent-yellow)]">{check.label}</p>
							<p class="text-xs text-[var(--text-secondary)]">{check.message}</p>
						</div>
					</div>
				{/each}
				{#each okChecks as check}
					<div class="flex items-start gap-3 px-3 py-2 rounded-lg bg-[var(--accent-green)]/5 border border-[var(--accent-green)]/10">
						<span class="mt-0.5 w-2 h-2 rounded-full bg-[var(--accent-green)] flex-shrink-0"></span>
						<div>
							<p class="text-sm font-medium text-[var(--accent-green)]">{check.label}</p>
							<p class="text-xs text-[var(--text-secondary)]">{check.message}</p>
						</div>
					</div>
				{/each}
			</div>
		</div>
	</div>
{/if}

<aside
	class="fixed top-0 left-0 z-50 w-64 bg-[var(--bg-secondary)] border-r border-[var(--border)] flex flex-col h-screen
		transition-transform duration-300 ease-in-out
		{open ? 'translate-x-0' : '-translate-x-full'}
		lg:translate-x-0 lg:sticky lg:z-auto"
>
	<!-- Title -->
	<div class="px-5 pt-5 pb-4 border-b border-[var(--border)]">
		<div class="flex items-center justify-between">
			<h1 class="text-xl font-bold text-white tracking-tight">AI-Trader</h1>
			<button class="lg:hidden text-[var(--text-secondary)] hover:text-white" onclick={onclose} aria-label="Close">
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>
		</div>
	</div>

	<!-- Bot Status -->
	<div class="px-4 py-3 border-b border-[var(--border)]">
		<p class="text-[10px] font-semibold text-[#9e9e9e] uppercase tracking-wider mb-2 px-1">Bot Status</p>
		<div class="space-y-1.5">
			<!-- LIVE / PAPER toggle -->
			<button
				onclick={ontogglemode}
				disabled={switchingMode}
				class="group flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm transition-all cursor-pointer
					disabled:opacity-50 disabled:cursor-not-allowed
				{mode === 'live'
					? 'bg-[var(--accent-green)]/10 border border-[var(--accent-green)]/25 hover:bg-[var(--accent-green)]/20'
					: 'bg-[var(--accent-yellow)]/10 border border-[var(--accent-yellow)]/25 hover:bg-[var(--accent-yellow)]/20'
				}"
			title={mode === 'live' ? '실제 자금으로 거래 — 클릭하여 Paper로 전환' : '모의 거래 — 클릭하여 Live로 전환'}
		>
			<span class="w-2 h-2 rounded-full flex-shrink-0 {mode === 'live' ? 'bg-[var(--accent-green)] animate-pulse' : 'bg-[var(--accent-yellow)]'}"></span>
			<span class="font-semibold uppercase text-xs {mode === 'live' ? 'text-[var(--accent-green)]' : 'text-[var(--accent-yellow)]'}">
				{switchingMode ? '전환 중...' : mode === 'live' ? 'Live Trading' : 'Paper Mode'}
				</span>
			</button>

			<!-- OpenClaw status -->
			<div class="flex items-center gap-2.5 px-3 py-2 rounded-lg
				{openclawReady
					? 'bg-[var(--accent-green)]/10 border border-[var(--accent-green)]/25'
					: openclawInfo.installed
					? 'bg-[var(--accent-yellow)]/10 border border-[var(--accent-yellow)]/25'
					: 'bg-[var(--accent-red)]/10 border border-[var(--accent-red)]/25'
				}">
				<span class="w-2 h-2 rounded-full flex-shrink-0
					{openclawReady
						? 'bg-[var(--accent-green)]'
						: openclawInfo.installed
						? 'bg-[var(--accent-yellow)]'
						: 'bg-[var(--accent-red)]'
					}"></span>
				<span class="font-semibold text-xs
					{openclawReady
						? 'text-[var(--accent-green)]'
						: openclawInfo.installed
						? 'text-[var(--accent-yellow)]'
						: 'text-[var(--accent-red)]'
					}">
					OpenClaw {openclawReady ? 'Connected' : openclawInfo.installed ? 'Daemon OFF' : 'Not Installed'}
				</span>
			</div>

			<!-- Warnings / Active -->
			{#if hasIssues}
				<button
					onclick={() => showWarnings = true}
					class="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm transition-all cursor-pointer
						{setup && setup.errors > 0
							? 'bg-[var(--accent-red)]/10 border border-[var(--accent-red)]/25 hover:bg-[var(--accent-red)]/20'
							: 'bg-[var(--accent-yellow)]/10 border border-[var(--accent-yellow)]/25 hover:bg-[var(--accent-yellow)]/20'
						}"
				>
					<span class="w-2 h-2 rounded-full flex-shrink-0 {setup && setup.errors > 0 ? 'bg-[var(--accent-red)]' : 'bg-[var(--accent-yellow)]'}"></span>
					<span class="font-semibold text-xs {setup && setup.errors > 0 ? 'text-[var(--accent-red)]' : 'text-[var(--accent-yellow)]'}">
						{#if setup && setup.errors > 0}
							{setup.errors} Error{setup.errors > 1 ? 's' : ''}
						{/if}
						{#if setup && setup.errors > 0 && setup.warnings > 0}
							{' · '}
						{/if}
						{#if setup && setup.warnings > 0}
							{setup.warnings} Warning{setup.warnings > 1 ? 's' : ''}
						{/if}
					</span>
					<svg class="w-3.5 h-3.5 ml-auto text-[var(--text-secondary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
					</svg>
				</button>
			{:else}
				<div class="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-[var(--accent-green)]/10 border border-[var(--accent-green)]/25">
					<span class="w-2 h-2 rounded-full bg-[var(--accent-green)] flex-shrink-0"></span>
					<span class="font-semibold text-xs text-[var(--accent-green)]">Active</span>
				</div>
			{/if}
		</div>
	</div>

	<!-- Navigation -->
	<nav class="flex-1 px-3 py-3 space-y-1 overflow-y-auto">
		{#each nav as item}
			{@const active = page.url.pathname === item.href || (item.href !== '/' && page.url.pathname.startsWith(item.href))}
			<button
				onclick={() => handleNav(item.href)}
				class="flex items-center gap-4 px-4 py-3 rounded-[10px] text-sm font-medium transition-all w-full text-left
					{active
						? 'bg-[#3a6ff8] text-white shadow-[4px_4px_32px_0px_rgba(58,111,248,0.15)]'
						: 'text-[#9e9e9e] hover:bg-[var(--bg-hover)] hover:text-white'}"
			>
				<svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width={active ? '2' : '1.5'}>
					<path stroke-linecap="round" stroke-linejoin="round" d={item.icon} />
				</svg>
				<span class={active ? 'font-semibold' : ''}>{item.label}</span>
			</button>
		{/each}
	</nav>

	<!-- Wallets -->
	<div class="mx-3 mb-3 px-3 py-2.5 rounded-[10px] bg-[var(--bg-card)] border border-[var(--border)]">
		<div class="flex items-center justify-between mb-2">
			<div class="flex items-center gap-1.5">
				<svg class="w-3.5 h-3.5 text-[var(--accent-green)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
				</svg>
				<span class="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Wallets</span>
			</div>
			<button
				onclick={togglePrivacy}
				class="p-1 rounded-md text-[var(--text-secondary)] hover:text-white hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
				title={isPrivate() ? '주소 보기' : '주소 숨기기'}
			>
				{#if isPrivate()}
					<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" /></svg>
				{:else}
					<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
				{/if}
			</button>
		</div>

		{#if walletAddresses?.hyperliquid}
			<div class="mb-1.5">
				<p class="text-[10px] text-[var(--accent-purple)] font-medium mb-0.5">HyperLiquid</p>
				<button
					onclick={() => !isPrivate() && walletAddresses?.hyperliquid && copyAddr(walletAddresses.hyperliquid.address, 'hl')}
					class="flex items-center gap-1 w-full group cursor-pointer"
					title={isPrivate() ? '주소 숨김' : walletAddresses.hyperliquid.address}
				>
					<code class="text-[10px] font-mono text-[var(--text-primary)] bg-black/30 px-1.5 py-0.5 rounded truncate flex-1 text-left group-hover:bg-[var(--bg-hover)] transition-colors">
						{isPrivate() ? maskAddr(walletAddresses.hyperliquid.address) : truncateAddr(walletAddresses.hyperliquid.address)}
					</code>
					{#if !isPrivate()}
						{#if copied === 'hl'}
							<svg class="w-3 h-3 text-[var(--accent-green)] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
						{:else}
							<svg class="w-3 h-3 text-[var(--text-secondary)] flex-shrink-0 opacity-50 group-hover:opacity-100" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
						{/if}
					{/if}
				</button>
			</div>
		{/if}

		{#if walletAddresses?.coinbase?.address}
			<div>
				<p class="text-[10px] text-[var(--accent-blue)] font-medium mb-0.5">Coinbase</p>
				<button
					onclick={() => !isPrivate() && walletAddresses?.coinbase?.address && copyAddr(walletAddresses.coinbase.address, 'cb')}
					class="flex items-center gap-1 w-full group cursor-pointer"
					title={isPrivate() ? '주소 숨김' : walletAddresses.coinbase.address}
				>
					<code class="text-[10px] font-mono text-[var(--text-primary)] bg-black/30 px-1.5 py-0.5 rounded truncate flex-1 text-left group-hover:bg-[var(--bg-hover)] transition-colors">
						{isPrivate() ? maskAddr(walletAddresses.coinbase.address) : truncateAddr(walletAddresses.coinbase.address)}
					</code>
					{#if !isPrivate()}
						{#if copied === 'cb'}
							<svg class="w-3 h-3 text-[var(--accent-green)] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
						{:else}
							<svg class="w-3 h-3 text-[var(--text-secondary)] flex-shrink-0 opacity-50 group-hover:opacity-100" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
						{/if}
					{/if}
				</button>
			</div>
		{/if}
	</div>

	<div class="px-5 py-3 border-t border-[var(--border)] text-[11px] text-[#9e9e9e]">
		v1.0 &middot; Svelte 5
	</div>
</aside>
