<script lang="ts">
	import '../app.css';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import type { SetupSummary, WalletAddresses } from '$lib/types';
	import { page } from '$app/state';

	let { children, data } = $props();
	let setup: SetupSummary = $state(data.setup as any);
	let mode: string = $state(data.mode);
	let walletAddresses: WalletAddresses = $state(data.walletAddresses as any);
	let switchingMode = $state(false);
	let sidebarOpen = $state(false);

	const pageTitle = $derived(() => {
		const p = page.url.pathname;
		if (p === '/') return 'Dashboard';
		if (p.startsWith('/positions')) return 'Positions';
		if (p.startsWith('/trades')) return 'Trades';
		if (p.startsWith('/signals')) return 'Signals';
		if (p.startsWith('/wallet')) return 'Wallet';
		if (p.startsWith('/control')) return 'Control';
		return 'AI Trader';
	});

	$effect(() => {
		const interval = setInterval(async () => {
			try {
				const [setupRes, modeRes, addrRes] = await Promise.all([
					fetch('/api/setup'),
					fetch('/api/bot/mode'),
					fetch('/api/wallet-addresses'),
				]);
				setup = await setupRes.json();
				const m = await modeRes.json();
				mode = m.mode;
				walletAddresses = await addrRes.json();
			} catch { /* ignore */ }
		}, 10000);
		return () => clearInterval(interval);
	});

	$effect(() => {
		page.url.pathname;
		sidebarOpen = false;
	});

	async function toggleMode() {
		const newMode = mode === 'paper' ? 'live' : 'paper';

		if (newMode === 'live') {
			const confirmed = confirm(
				'WARNING: Switching to LIVE mode will execute real trades with real funds.\n\n' +
				'Make sure all API keys and wallet configurations are properly set.\n\n' +
				'Are you sure you want to switch to LIVE mode?'
			);
			if (!confirmed) return;
		}

		switchingMode = true;
		try {
			const res = await fetch('/api/bot/mode', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mode: newMode }),
			});
			const result = await res.json();
			if (result.success) {
				mode = result.mode;
				const setupRes = await fetch('/api/setup');
				setup = await setupRes.json();
			}
		} catch { /* ignore */ }
		switchingMode = false;
	}
</script>

<div class="flex min-h-screen bg-[var(--bg-primary)]">
	<Sidebar {mode} {walletAddresses} {setup} {switchingMode} open={sidebarOpen} onclose={() => sidebarOpen = false} ontogglemode={toggleMode} />

	<div class="flex-1 flex flex-col min-w-0">
		<!-- Mobile top bar -->
		<div class="flex lg:hidden items-center justify-between px-4 py-2.5 bg-[var(--bg-secondary)] border-b border-[var(--border)]">
			<div class="flex items-center gap-3">
				<button
					class="text-[var(--text-secondary)] hover:text-white p-1 -ml-1"
					onclick={() => sidebarOpen = true}
					aria-label="Open menu"
				>
					<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
					</svg>
				</button>
				<span class="text-sm font-semibold text-white">{pageTitle()}</span>
			</div>
			<button
				onclick={toggleMode}
				disabled={switchingMode}
				class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-bold uppercase cursor-pointer transition-all
					disabled:opacity-50 disabled:cursor-not-allowed
					{mode === 'live'
						? 'bg-[var(--accent-red)]/15 border-[var(--accent-red)]/40 text-[var(--accent-red)]'
						: 'bg-[var(--accent-yellow)]/15 border-[var(--accent-yellow)]/40 text-[var(--accent-yellow)]'
					}"
			>
				<span class="w-1.5 h-1.5 rounded-full {mode === 'live' ? 'bg-[var(--accent-red)] animate-pulse' : 'bg-[var(--accent-yellow)]'}"></span>
				{switchingMode ? '...' : mode}
			</button>
		</div>

		<main class="flex-1 p-4 lg:p-6">
			{@render children()}
		</main>
	</div>
</div>
