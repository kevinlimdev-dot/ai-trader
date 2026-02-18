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

<div class="box min-w-0 overflow-hidden">
	<p class="text-[10px] sm:text-xs text-[var(--text-secondary)] uppercase tracking-wider mb-1 truncate">{label}</p>
	<p class="text-lg sm:text-2xl font-bold {colorMap[color]} truncate">{value}</p>
	{#if sub}
		<p class="text-[10px] sm:text-xs text-[var(--text-secondary)] mt-1 truncate">{sub}</p>
	{/if}
</div>
