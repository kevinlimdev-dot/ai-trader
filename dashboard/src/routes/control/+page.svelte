<script lang="ts">
	import type { BotResult, SetupSummary } from '$lib/types';

	let { data } = $props();
	let mode = $state(data.mode);
	let killSwitch = $state(data.killSwitch);
	let apiErrorCount = $state(data.apiErrorCount);
	let configYaml = $state(data.configYaml);
	let setup: SetupSummary = $state(data.setup as any);

	let togglingKs = $state(false);
	let switchingMode = $state(false);
	let runningScript: string | null = $state(null);
	let lastResult: BotResult | null = $state(null);

	// Poll status
	$effect(() => {
		const interval = setInterval(async () => {
			try {
				const [ksRes, modeRes, setupRes] = await Promise.all([
					fetch('/api/bot/kill-switch'),
					fetch('/api/bot/mode'),
					fetch('/api/setup'),
				]);
				killSwitch = (await ksRes.json()).active;
				mode = (await modeRes.json()).mode;
				setup = await setupRes.json();
			} catch { /* ignore */ }
		}, 5000);
		return () => clearInterval(interval);
	});

	async function toggleKillSwitch() {
		togglingKs = true;
		try {
			const res = await fetch('/api/bot/kill-switch', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ enabled: !killSwitch }),
			});
			killSwitch = (await res.json()).active;
		} catch { /* ignore */ }
		togglingKs = false;
	}

	async function switchMode(newMode: string) {
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
			if (result.success) mode = result.mode;
			// Refresh setup checks
			const setupRes = await fetch('/api/setup');
			setup = await setupRes.json();
		} catch { /* ignore */ }
		switchingMode = false;
	}

	async function runScript(script: string, label: string) {
		runningScript = script;
		lastResult = null;
		try {
			const res = await fetch('/api/bot/run', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ script }),
			});
			lastResult = await res.json();
		} catch (e) {
			lastResult = { success: false, error: String(e) };
		} finally {
			runningScript = null;
		}
	}

	const scripts = [
		{ id: 'collect', label: 'Collect Prices', desc: 'Fetch latest prices from Binance & HyperLiquid', color: 'var(--accent-blue)' },
		{ id: 'analyze', label: 'Analyze', desc: 'Run technical analysis & generate signals', color: 'var(--accent-purple)' },
		{ id: 'trade', label: 'Execute Trade', desc: 'Execute trades based on signals', color: 'var(--accent-green)' },
		{ id: 'monitor', label: 'Monitor', desc: 'Check open positions for SL/TP/trailing', color: 'var(--accent-yellow)' },
		{ id: 'pipeline', label: 'Full Pipeline', desc: 'Collect -> Analyze -> Trade', color: 'var(--accent-blue)' },
		{ id: 'daily-summary', label: 'Daily Summary', desc: "Generate today's trading summary", color: 'var(--text-secondary)' },
	];
</script>

<svelte:head><title>AI Trader - Control</title></svelte:head>

<div class="space-y-6">
	<h1 class="text-2xl font-bold">Bot Control</h1>

	<!-- Status Cards -->
	<div class="grid grid-cols-1 md:grid-cols-4 gap-4">
		<!-- Mode Switch Card -->
		<div class="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5">
			<p class="text-xs text-[var(--text-secondary)] uppercase tracking-wider mb-3">Trading Mode</p>
			<div class="flex gap-2">
				<button
					onclick={() => switchMode('paper')}
					disabled={switchingMode || mode === 'paper'}
					class="flex-1 px-3 py-2 rounded-lg text-sm font-semibold transition-all border
						{mode === 'paper'
							? 'bg-[var(--accent-yellow)]/15 border-[var(--accent-yellow)]/40 text-[var(--accent-yellow)]'
							: 'bg-[var(--bg-secondary)] border-[var(--border)] text-[var(--text-secondary)] hover:text-white hover:border-[var(--accent-yellow)]/30 cursor-pointer'
						}
						disabled:opacity-60"
				>
					PAPER
				</button>
				<button
					onclick={() => switchMode('live')}
					disabled={switchingMode || mode === 'live'}
					class="flex-1 px-3 py-2 rounded-lg text-sm font-semibold transition-all border
						{mode === 'live'
							? 'bg-[var(--accent-red)]/15 border-[var(--accent-red)]/40 text-[var(--accent-red)]'
							: 'bg-[var(--bg-secondary)] border-[var(--border)] text-[var(--text-secondary)] hover:text-white hover:border-[var(--accent-red)]/30 cursor-pointer'
						}
						disabled:opacity-60"
				>
					LIVE
				</button>
			</div>
			<p class="text-[10px] text-[var(--text-secondary)] mt-2">
				{mode === 'live' ? 'Real orders executed on HyperLiquid' : 'Simulated trades, no real orders'}
			</p>
		</div>

		<!-- Kill Switch Card -->
		<div class="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5">
			<p class="text-xs text-[var(--text-secondary)] uppercase tracking-wider mb-2">Kill Switch</p>
			<div class="flex items-center gap-3">
				<button
					onclick={toggleKillSwitch}
					disabled={togglingKs}
					aria-label="Toggle Kill Switch"
					class="relative w-14 h-7 rounded-full transition-colors cursor-pointer {killSwitch ? 'bg-[var(--accent-red)]' : 'bg-gray-600'}"
				>
					<span class="absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white transition-transform {killSwitch ? 'translate-x-7' : 'translate-x-0'}"></span>
				</button>
				<span class="text-sm font-medium {killSwitch ? 'text-[var(--accent-red)]' : 'text-[var(--accent-green)]'}">
					{killSwitch ? 'ACTIVE' : 'Inactive'}
				</span>
			</div>
		</div>

		<!-- API Errors Card -->
		<div class="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5">
			<p class="text-xs text-[var(--text-secondary)] uppercase tracking-wider mb-2">API Errors</p>
			<p class="text-2xl font-bold {apiErrorCount > 0 ? 'text-[var(--accent-red)]' : 'text-[var(--accent-green)]'}">{apiErrorCount}</p>
			<p class="text-xs text-[var(--text-secondary)]">Consecutive errors</p>
		</div>

		<!-- Setup Status Card -->
		<div class="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5">
			<p class="text-xs text-[var(--text-secondary)] uppercase tracking-wider mb-2">Setup Status</p>
			{#if setup.ok}
				<div class="flex items-center gap-2">
					<span class="w-3 h-3 rounded-full bg-[var(--accent-green)]"></span>
					<span class="text-sm font-medium text-[var(--accent-green)]">All Clear</span>
				</div>
			{:else}
				<div class="flex items-center gap-2">
					<span class="w-3 h-3 rounded-full bg-[var(--accent-red)]"></span>
					<span class="text-sm font-medium text-[var(--accent-red)]">{setup.errors} Error{setup.errors > 1 ? 's' : ''}</span>
				</div>
			{/if}
			{#if setup.warnings > 0}
				<p class="text-xs text-[var(--accent-yellow)] mt-1">{setup.warnings} warning{setup.warnings > 1 ? 's' : ''}</p>
			{/if}
		</div>
	</div>

	<!-- Setup Details -->
	<div class="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5">
		<h2 class="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-4">Environment Setup</h2>
		<div class="grid grid-cols-1 md:grid-cols-2 gap-2">
			{#each setup.checks as check}
				<div class="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-[var(--bg-secondary)]">
					{#if check.status === 'ok'}
						<svg class="w-4 h-4 text-[var(--accent-green)] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
						</svg>
					{:else if check.status === 'error'}
						<svg class="w-4 h-4 text-[var(--accent-red)] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
						</svg>
					{:else}
						<svg class="w-4 h-4 text-[var(--accent-yellow)] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
						</svg>
					{/if}
					<div class="flex-1 min-w-0">
						<p class="text-sm font-medium {check.status === 'ok' ? 'text-[var(--text-primary)]' : check.status === 'error' ? 'text-[var(--accent-red)]' : 'text-[var(--accent-yellow)]'}">
							{check.label}
							{#if check.required}
								<span class="text-[10px] text-[var(--text-secondary)] ml-1">required</span>
							{/if}
						</p>
						<p class="text-xs text-[var(--text-secondary)] truncate">{check.message}</p>
					</div>
				</div>
			{/each}
		</div>
	</div>

	<!-- Manual Run Buttons -->
	<div class="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5">
		<h2 class="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-4">Manual Execution</h2>
		<div class="grid grid-cols-2 md:grid-cols-3 gap-3">
			{#each scripts as s}
				<button
					onclick={() => runScript(s.id, s.label)}
					disabled={runningScript !== null}
					class="relative bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg p-4 text-left hover:bg-[var(--bg-hover)] transition-all disabled:opacity-50 group cursor-pointer"
				>
					{#if runningScript === s.id}
						<div class="absolute inset-0 flex items-center justify-center bg-[var(--bg-secondary)]/80 rounded-lg">
							<span class="text-sm text-[var(--text-secondary)]">Running...</span>
						</div>
					{/if}
					<p class="text-sm font-medium" style="color: {s.color}">{s.label}</p>
					<p class="text-xs text-[var(--text-secondary)] mt-1">{s.desc}</p>
				</button>
			{/each}
		</div>
	</div>

	<!-- Results -->
	{#if lastResult}
		<div class="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5">
			<div class="flex items-center justify-between mb-3">
				<h2 class="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Execution Result</h2>
				<span class="px-2 py-0.5 rounded text-xs font-medium {lastResult.success ? 'bg-[var(--accent-green)]/15 text-[var(--accent-green)]' : 'bg-[var(--accent-red)]/15 text-[var(--accent-red)]'}">
					{lastResult.success ? 'SUCCESS' : 'FAILED'}
				</span>
			</div>
			<pre class="bg-[var(--bg-primary)] rounded-lg p-4 text-xs font-mono overflow-x-auto max-h-96 text-[var(--text-secondary)]">{typeof lastResult.data === 'string' ? lastResult.data : JSON.stringify(lastResult.data, null, 2)}{#if lastResult.error}
Error: {lastResult.error}{/if}</pre>
			{#if lastResult.raw && lastResult.raw !== JSON.stringify(lastResult.data)}
				<details class="mt-3">
					<summary class="text-xs text-[var(--text-secondary)] cursor-pointer hover:text-white">Raw Output</summary>
					<pre class="bg-[var(--bg-primary)] rounded-lg p-4 text-xs font-mono overflow-x-auto max-h-64 mt-2 text-[var(--text-secondary)]">{lastResult.raw}</pre>
				</details>
			{/if}
		</div>
	{/if}

	<!-- Config Viewer -->
	<div class="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5">
		<h2 class="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">Current Configuration</h2>
		<pre class="bg-[var(--bg-primary)] rounded-lg p-4 text-xs font-mono overflow-x-auto max-h-96 text-[var(--text-secondary)]">{configYaml}</pre>
	</div>
</div>
