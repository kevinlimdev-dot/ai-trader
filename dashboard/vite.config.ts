import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		host: '0.0.0.0',
	},
	ssr: {
		external: ['bun:sqlite', '@nktkas/hyperliquid', 'viem', 'viem/accounts'],
	},
});
