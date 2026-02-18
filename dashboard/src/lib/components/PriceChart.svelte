<script lang="ts">
	import { onMount } from 'svelte';
	import { createChart, type IChartApi, ColorType, LineStyle, LineSeries } from 'lightweight-charts';

	interface Props {
		symbol: string;
		data: { time: string; binance: number; hyperliquid: number }[];
	}

	let { symbol, data }: Props = $props();

	let chartContainer: HTMLDivElement;
	let chart: IChartApi | null = null;
	let binanceSeries: any = null;
	let hlSeries: any = null;

	onMount(() => {
		chart = createChart(chartContainer, {
			layout: {
				background: { type: ColorType.Solid, color: 'transparent' },
				textColor: '#8b8fa3',
				fontSize: 11,
			},
			grid: {
				vertLines: { color: '#2a2f42', style: LineStyle.Dotted },
				horzLines: { color: '#2a2f42', style: LineStyle.Dotted },
			},
			width: chartContainer.clientWidth,
			height: 750,
			rightPriceScale: {
				borderColor: '#2a2f42',
			},
			timeScale: {
				borderColor: '#2a2f42',
				timeVisible: true,
			},
			crosshair: {
				vertLine: { color: '#3b82f6', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#3b82f6' },
				horzLine: { color: '#3b82f6', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#3b82f6' },
			},
		});

		binanceSeries = chart.addSeries(LineSeries, {
			color: '#eab308',
			lineWidth: 2,
			title: 'Binance',
		});

		hlSeries = chart.addSeries(LineSeries, {
			color: '#10b981',
			lineWidth: 2,
			title: 'HyperLiquid',
		});

		updateData();

		const observer = new ResizeObserver(() => {
			chart?.applyOptions({ width: chartContainer.clientWidth });
		});
		observer.observe(chartContainer);

		return () => {
			observer.disconnect();
			chart?.remove();
		};
	});

	function updateData() {
		if (!binanceSeries || !hlSeries || !data || data.length === 0) return;

		const binanceData = data.map(d => ({
			time: Math.floor(new Date(d.time).getTime() / 1000) as any,
			value: d.binance,
		})).sort((a, b) => a.time - b.time);

		const hlData = data.map(d => ({
			time: Math.floor(new Date(d.time).getTime() / 1000) as any,
			value: d.hyperliquid,
		})).sort((a, b) => a.time - b.time);

		binanceSeries.setData(binanceData);
		hlSeries.setData(hlData);
		chart?.timeScale().fitContent();
	}

	$effect(() => {
		if (data) updateData();
	});
</script>

<div bind:this={chartContainer}></div>
