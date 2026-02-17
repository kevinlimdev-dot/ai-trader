import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolve } from 'path';
import { existsSync, readFileSync } from 'fs';

const PROJECT_ROOT = resolve(process.cwd(), '..');

export const POST: RequestHandler = async ({ request }) => {
	const { action, amount } = await request.json().catch(() => ({ action: 'check', amount: undefined }));

	// .env에서 키 읽기
	const envPath = resolve(PROJECT_ROOT, '.env');
	if (!existsSync(envPath)) {
		return json({ status: 'error', error: '.env 파일 없음' }, { status: 400 });
	}

	const envContent = readFileSync(envPath, 'utf-8');
	let privateKey = '';
	for (const line of envContent.split('\n')) {
		const trimmed = line.trim();
		if (trimmed.startsWith('HYPERLIQUID_PRIVATE_KEY=')) {
			privateKey = trimmed.slice('HYPERLIQUID_PRIVATE_KEY='.length).trim();
		}
	}

	if (!privateKey || privateKey.length < 10) {
		return json({ status: 'error', error: 'HYPERLIQUID_PRIVATE_KEY 미설정' }, { status: 400 });
	}

	if (action === 'check') {
		// Arbitrum USDC 잔고 확인만
		try {
			const proc = Bun.spawn(
				['bun', 'run', 'skills/wallet-manager/scripts/deposit-to-hl.ts', '--dry-run'],
				{ cwd: PROJECT_ROOT, env: { ...process.env }, stdout: 'pipe', stderr: 'pipe' }
			);
			const stdout = await new Response(proc.stdout).text();
			const exitCode = await proc.exited;

			// dry-run JSON 결과 파싱
			const jsonMatch = stdout.match(/\{[\s\S]*"status"\s*:\s*"dry_run"[\s\S]*\}/);
			if (jsonMatch) {
				return json(JSON.parse(jsonMatch[0]));
			}
			return json({ status: 'error', error: 'dry-run 결과 파싱 실패', raw: stdout });
		} catch (err) {
			return json({ status: 'error', error: err instanceof Error ? err.message : String(err) });
		}
	}

	if (action === 'deposit') {
		// 실제 입금 실행
		const args = ['bun', 'run', 'skills/wallet-manager/scripts/deposit-to-hl.ts'];
		if (amount) args.push('--amount', String(amount));

		try {
			const proc = Bun.spawn(args, {
				cwd: PROJECT_ROOT,
				env: { ...process.env },
				stdout: 'pipe',
				stderr: 'pipe',
			});
			const stdout = await new Response(proc.stdout).text();
			const exitCode = await proc.exited;

			const jsonMatch = stdout.match(/\{[\s\S]*"status"\s*:\s*"success"[\s\S]*\}/);
			if (jsonMatch) {
				return json(JSON.parse(jsonMatch[0]));
			}

			const errMatch = stdout.match(/\{[\s\S]*"status"\s*:\s*"error"[\s\S]*\}/);
			if (errMatch) {
				return json(JSON.parse(errMatch[0]), { status: 400 });
			}

			return json({
				status: exitCode === 0 ? 'success' : 'error',
				raw: stdout,
			});
		} catch (err) {
			return json({ status: 'error', error: err instanceof Error ? err.message : String(err) }, { status: 500 });
		}
	}

	return json({ status: 'error', error: `알 수 없는 action: ${action}` }, { status: 400 });
};
