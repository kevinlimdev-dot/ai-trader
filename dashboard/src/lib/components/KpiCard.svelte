<script lang="ts">
	interface Props {
		label: string;
		value: string;
		sub?: string;
		color?: 'green' | 'red' | 'blue' | 'yellow' | 'purple' | 'default';
	}

	let { label, value, sub, color = 'default' }: Props = $props();

	const colorMap: Record<string, string> = {
		green: 'text-[var(--accent-green)]',
		red: 'text-[var(--accent-red)]',
		blue: 'text-[var(--accent-blue)]',
		yellow: 'text-[var(--accent-yellow)]',
		purple: 'text-[var(--accent-purple)]',
		default: 'text-white',
	};
</script>

<div class="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4">
	<p class="text-xs text-[var(--text-secondary)] uppercase tracking-wider mb-1">{label}</p>
	<p class="text-2xl font-bold {colorMap[color]}">{value}</p>
	{#if sub}
		<p class="text-xs text-[var(--text-secondary)] mt-1">{sub}</p>
	{/if}
</div>
