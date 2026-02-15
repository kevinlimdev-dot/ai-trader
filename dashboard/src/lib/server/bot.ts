import { resolve } from 'path';
import { existsSync, writeFileSync, unlinkSync } from 'fs';

const PROJECT_ROOT = resolve(process.cwd(), '..');

type ScriptName = 'collect' | 'analyze' | 'trade' | 'monitor' | 'positions' | 'close-all' | 'emergency' | 'daily-summary' | 'balance' | 'daily-report' | 'auto-rebalance' | 'pipeline';

interface ScriptResult {
	success: boolean;
	data?: unknown;
	error?: string;
	raw?: string;
}

function getScriptCommand(script: ScriptName): { file: string; args: string[] } {
	switch (script) {
		case 'collect':
			return { file: 'skills/data-collector/scripts/collect-prices.ts', args: [] };
		case 'analyze':
			return { file: 'skills/analyzer/scripts/analyze.ts', args: [] };
		case 'trade':
			return { file: 'skills/trader/scripts/execute-trade.ts', args: [] };
		case 'monitor':
			return { file: 'skills/trader/scripts/execute-trade.ts', args: ['--action', 'monitor'] };
		case 'positions':
			return { file: 'skills/trader/scripts/execute-trade.ts', args: ['--action', 'positions'] };
		case 'close-all':
			return { file: 'skills/trader/scripts/execute-trade.ts', args: ['--action', 'close-all', '--reason', 'dashboard'] };
		case 'emergency':
			return { file: 'skills/trader/scripts/execute-trade.ts', args: ['--action', 'emergency'] };
		case 'daily-summary':
			return { file: 'skills/trader/scripts/execute-trade.ts', args: ['--action', 'daily-summary'] };
		case 'balance':
			return { file: 'skills/wallet-manager/scripts/manage-wallet.ts', args: ['--action', 'balance'] };
		case 'daily-report':
			return { file: 'skills/wallet-manager/scripts/manage-wallet.ts', args: ['--action', 'daily-report'] };
		case 'auto-rebalance':
			return { file: 'skills/wallet-manager/scripts/manage-wallet.ts', args: ['--action', 'auto-rebalance'] };
		case 'pipeline':
			return { file: '', args: [] }; // handled separately
		default:
			throw new Error(`Unknown script: ${script}`);
	}
}

export async function runScript(script: ScriptName, extraArgs: string[] = []): Promise<ScriptResult> {
	if (script === 'pipeline') {
		return runPipeline();
	}

	const { file, args } = getScriptCommand(script);
	const scriptPath = resolve(PROJECT_ROOT, file);

	try {
		const proc = Bun.spawn(['bun', 'run', scriptPath, ...args, ...extraArgs], {
			cwd: PROJECT_ROOT,
			stdout: 'pipe',
			stderr: 'pipe',
			env: { ...process.env },
		});

		const timeoutMs = 30_000;
		const timer = setTimeout(() => proc.kill(), timeoutMs);
		const exitCode = await proc.exited;
		clearTimeout(timer);

		const stdout = await new Response(proc.stdout).text();
		const stderr = await new Response(proc.stderr).text();

		if (exitCode !== 0) {
			return { success: false, error: stderr.trim() || stdout.trim(), raw: stdout };
		}

		// Extract JSON from stdout (skip log lines)
		try {
			const lines = stdout.trim().split('\n');
			// Find last JSON block
			let jsonStr = '';
			let depth = 0;
			let inJson = false;
			for (const line of lines) {
				const trimmed = line.trim();
				if (!inJson && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
					inJson = true;
					jsonStr = '';
				}
				if (inJson) {
					jsonStr += line + '\n';
					for (const ch of trimmed) {
						if (ch === '{' || ch === '[') depth++;
						if (ch === '}' || ch === ']') depth--;
					}
					if (depth <= 0) {
						inJson = false;
						depth = 0;
					}
				}
			}
			const data = JSON.parse(jsonStr.trim());
			return { success: true, data, raw: stdout };
		} catch {
			return { success: true, data: stdout.trim(), raw: stdout };
		}
	} catch (err) {
		return { success: false, error: err instanceof Error ? err.message : String(err) };
	}
}

async function runPipeline(): Promise<ScriptResult> {
	const results: Record<string, ScriptResult> = {};

	results.collect = await runScript('collect');
	if (!results.collect.success) return { success: false, error: 'collect failed', data: results };

	results.analyze = await runScript('analyze');
	if (!results.analyze.success) return { success: false, error: 'analyze failed', data: results };

	// 거래 전 자동 자금 리밸런싱 (잔고 부족 방지)
	results.rebalance = await runScript('auto-rebalance');
	// rebalance 실패해도 거래는 진행 (잔고 부족이면 거래에서 자체 판단)

	results.trade = await runScript('trade');

	return { success: true, data: results };
}

export function toggleKillSwitch(enabled: boolean): boolean {
	const configStr = Bun.file(resolve(PROJECT_ROOT, 'config.yaml')).text();
	// Read kill switch file path from config or use default
	const ksPath = resolve(PROJECT_ROOT, 'data', 'KILL_SWITCH');

	if (enabled) {
		writeFileSync(ksPath, `Activated from dashboard at ${new Date().toISOString()}\n`);
		return true;
	} else {
		if (existsSync(ksPath)) {
			unlinkSync(ksPath);
		}
		return false;
	}
}
