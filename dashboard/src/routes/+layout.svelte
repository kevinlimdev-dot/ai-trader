<script lang="ts">
	import '../app.css';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import SetupBanner from '$lib/components/SetupBanner.svelte';
	import type { SetupSummary, WalletAddresses } from '$lib/types';

	let { children, data } = $props();
	let setup: SetupSummary = $state(data.setup as any);
	let mode: string = $state(data.mode);
	let walletAddresses: WalletAddresses = $state(data.walletAddresses as any);
	let showSetupDetail = $state(false);
	let switchingMode = $state(false);

	// Poll setup status + mode + wallet addresses every 10s
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
				// Refresh setup (live mode may trigger new errors)
				const setupRes = await fetch('/api/setup');
				setup = await setupRes.json();
			}
		} catch { /* ignore */ }
		switchingMode = false;
	}
</script>

<div class="flex min-h-screen">
	<Sidebar {mode} {walletAddresses} />
	<div class="flex-1 flex flex-col overflow-auto">
		<!-- Setup Warning Banner -->
		{#if !setup.ok || setup.warnings > 0}
			<SetupBanner {setup} bind:showDetail={showSetupDetail} />
		{/if}

		<!-- Mode switcher bar -->
		<div class="flex items-center justify-between px-6 py-2.5 bg-[var(--bg-secondary)] border-b border-[var(--border)]">
			<div class="flex items-center gap-3 text-sm">
				<span class="text-[var(--text-secondary)]">Trading Mode:</span>
				<button
					onclick={toggleMode}
					disabled={switchingMode}
					class="relative flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all cursor-pointer
						{mode === 'live'
							? 'bg-[var(--accent-red)]/10 border-[var(--accent-red)]/40 text-[var(--accent-red)]'
							: 'bg-[var(--accent-yellow)]/10 border-[var(--accent-yellow)]/40 text-[var(--accent-yellow)]'
						}
						hover:opacity-80 disabled:opacity-50"
				>
					<span class="w-2 h-2 rounded-full {mode === 'live' ? 'bg-[var(--accent-red)] animate-pulse' : 'bg-[var(--accent-yellow)]'}"></span>
					<span class="font-semibold text-xs uppercase">{switchingMode ? 'Switching...' : mode}</span>
				</button>
				<span class="text-xs text-[var(--text-secondary)]">
					{mode === 'live' ? 'Real trades with real funds' : 'Simulated trades, no real orders'}
				</span>
			</div>
			<div class="flex items-center gap-2">
				{#if mode === 'live'}
					<span class="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-[var(--accent-red)]/10 text-[var(--accent-red)] border border-[var(--accent-red)]/30">
						<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
						</svg>
						LIVE
					</span>
				{/if}
			</div>
		</div>

		<main class="flex-1 p-6">
			{@render children()}
		</main>
	</div>
</div>
