<script lang="ts">
	interface Props { action: string; confidence?: number; }
	let { action, confidence }: Props = $props();

	const cls: Record<string, string> = {
		LONG: 'bg-[var(--accent-green)]/15 text-[var(--accent-green)] border-[var(--accent-green)]/30',
		SHORT: 'bg-[var(--accent-red)]/15 text-[var(--accent-red)] border-[var(--accent-red)]/30',
		HOLD: 'bg-gray-700/50 text-gray-400 border-gray-600',
	};
</script>

<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm font-semibold border {cls[action] || cls.HOLD}">
	{action}
	{#if confidence !== undefined}
		<span class="text-xs opacity-70">({(confidence * 100).toFixed(0)}%)</span>
	{/if}
</span>
