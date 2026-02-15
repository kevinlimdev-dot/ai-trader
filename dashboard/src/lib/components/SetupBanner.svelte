<script lang="ts">
	import type { SetupSummary } from '$lib/types';

	interface Props {
		setup: SetupSummary;
		showDetail: boolean;
	}

	let { setup, showDetail = $bindable(false) }: Props = $props();

	let hasErrors = $derived(setup.errors > 0);
	let errorChecks = $derived(setup.checks.filter(c => c.status === 'error'));
	let warningChecks = $derived(setup.checks.filter(c => c.status === 'warning'));
	let okChecks = $derived(setup.checks.filter(c => c.status === 'ok'));
</script>

<!-- Persistent banner -->
{#if hasErrors}
	<div class="bg-[var(--accent-red)]/10 border-b border-[var(--accent-red)]/30 px-6 py-2.5">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-2">
				<svg class="w-5 h-5 text-[var(--accent-red)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
				</svg>
				<span class="text-sm font-medium text-[var(--accent-red)]">
					{setup.errors} required setting{setup.errors > 1 ? 's' : ''} not configured
				</span>
				{#if setup.warnings > 0}
					<span class="text-xs text-[var(--accent-yellow)]">+ {setup.warnings} warning{setup.warnings > 1 ? 's' : ''}</span>
				{/if}
			</div>
			<button onclick={() => showDetail = !showDetail} class="text-xs text-[var(--accent-red)] hover:underline cursor-pointer">
				{showDetail ? 'Hide' : 'Show details'}
			</button>
		</div>
	</div>
{:else if setup.warnings > 0}
	<div class="bg-[var(--accent-yellow)]/8 border-b border-[var(--accent-yellow)]/20 px-6 py-2">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-2">
				<svg class="w-4 h-4 text-[var(--accent-yellow)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
				</svg>
				<span class="text-xs text-[var(--accent-yellow)]">
					{setup.warnings} optional setting{setup.warnings > 1 ? 's' : ''} to review
				</span>
			</div>
			<button onclick={() => showDetail = !showDetail} class="text-xs text-[var(--accent-yellow)] hover:underline cursor-pointer">
				{showDetail ? 'Hide' : 'Details'}
			</button>
		</div>
	</div>
{/if}

<!-- Detail panel -->
{#if showDetail}
	<div class="bg-[var(--bg-secondary)] border-b border-[var(--border)] px-6 py-4">
		<div class="max-w-3xl">
			<h3 class="text-sm font-semibold mb-3">Setup Status</h3>
			<div class="space-y-2">
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
