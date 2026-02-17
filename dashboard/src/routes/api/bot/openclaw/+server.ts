import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolve } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';

const PROJECT_ROOT = resolve(process.cwd(), '..');
const OUTPUT_FILE = '/tmp/ai-trader-openclaw-output.txt';
const STATUS_FILE = '/tmp/ai-trader-openclaw-status.json';

// OpenClaw 바이너리 경로 해결
const KNOWN_PATHS = [
	resolve(process.env.HOME || '/Users/kevin', '.bun/bin/openclaw'),
	'/usr/local/bin/openclaw',
	'/opt/homebrew/bin/openclaw',
];

function findOpenClaw(): string | null {
	for (const p of KNOWN_PATHS) {
		if (existsSync(p)) return p;
	}
	try {
		const proc = Bun.spawnSync(['which', 'openclaw'], { stdout: 'pipe', stderr: 'pipe' });
		if (proc.exitCode === 0) {
			const found = new TextDecoder().decode(proc.stdout).trim();
			if (found && existsSync(found)) return found;
		}
	} catch { /* ignore */ }
	return null;
}

function checkDaemon(bin: string): boolean {
	try {
		const proc = Bun.spawnSync([bin, 'daemon', 'status'], { stdout: 'pipe', stderr: 'pipe' });
		const output = new TextDecoder().decode(proc.stdout);
		return proc.exitCode === 0 && output.includes('loaded');
	} catch {
		return false;
	}
}

interface OpenClawStatus {
	state: 'idle' | 'running' | 'done' | 'failed';
	pid?: number;
	action?: string;
	prompt?: string;
	startedAt?: string;
	completedAt?: string;
	exitCode?: number;
}

function readStatus(): OpenClawStatus {
	if (!existsSync(STATUS_FILE)) return { state: 'idle' };
	try {
		const raw: OpenClawStatus = JSON.parse(readFileSync(STATUS_FILE, 'utf-8'));
		if (raw.state === 'running' && raw.pid) {
			try {
				process.kill(raw.pid, 0);
			} catch {
				raw.state = 'failed';
				raw.completedAt = new Date().toISOString();
				writeFileSync(STATUS_FILE, JSON.stringify(raw));
			}
		}
		return raw;
	} catch {
		return { state: 'idle' };
	}
}

function readOutput(): string {
	if (!existsSync(OUTPUT_FILE)) return '';
	try {
		return readFileSync(OUTPUT_FILE, 'utf-8');
	} catch {
		return '';
	}
}

/** GET: OpenClaw 상태 + 출력 + 연결 상태 */
export const GET: RequestHandler = async () => {
	const bin = findOpenClaw();
	const status = readStatus();
	const output = readOutput();

	return json({
		...status,
		output,
		openclaw: {
			installed: !!bin,
			path: bin,
			daemonRunning: bin ? checkDaemon(bin) : false,
		},
	});
};

/** POST: OpenClaw 에이전트를 통해 파이프라인 실행 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const action = (body.action as string) || 'pipeline';

	// OpenClaw 바이너리 확인
	const bin = findOpenClaw();
	if (!bin) {
		return json({ success: false, error: 'OpenClaw not installed. Run: bun add -g openclaw' });
	}

	// 데몬 확인
	if (!checkDaemon(bin)) {
		return json({ success: false, error: 'OpenClaw daemon not running. Run: openclaw daemon start' });
	}

	// 이미 실행 중인지 확인
	const current = readStatus();
	if (current.state === 'running') {
		return json({ success: false, error: 'OpenClaw agent already running' });
	}

	let prompt: string;
	switch (action) {
		case 'pipeline': {
			const cd = `cd /Users/kevin/Documents/GitHub/ai-trader`;
			prompt = `너는 자율적인 AI 투자 판단자야. 아래 7단계를 순서대로 실행해.
4단계에서 기술적 분석 + 시장 심리를 종합하여 독립적으로 투자 결정을 내려.

## 1단계: 가격 수집
${cd} && bun run skills/data-collector/scripts/collect-prices.ts

## 2단계: 기술적 분석
${cd} && bun run skills/analyzer/scripts/analyze.ts

## 3단계: 시장 심리 수집
${cd} && bun run skills/ai-decision/scripts/collect-sentiment.ts

## 4단계: ★ AI 자율 투자 판단 (핵심) ★
${cd} && bun run skills/ai-decision/scripts/summarize.ts

이 JSON에 기술적 지표와 시장 심리(market_sentiment)가 모두 포함됨.

판단 시 고려:
- 기술적: composite_score, RSI, MACD cross, 볼린저 위치
- 심리: crowd_bias(역발상), smart_money(추종), taker_pressure(모멘텀), funding_rate(극단치 반전), OI 변화
- 군중 편향과 스마트 머니 방향이 반대면 스마트 머니를 따라가
- 펀딩비가 극단적이면 반대 포지션이 유리 (펀딩비 수취)
- 여러 데이터가 합류(confluence)하는 방향만 진입

decisions JSON을 만들어 전달:
${cd} && bun run skills/ai-decision/scripts/apply-decision.ts --decisions '<JSON 배열>'
형식: [{"symbol":"BTC","action":"LONG","confidence":0.7,"reason":"RSI 반등 + 스마트머니 롱 + 군중 숏(역발상)"}]

## 5단계: 자금 확인
${cd} && bun run skills/wallet-manager/scripts/manage-wallet.ts --action auto-rebalance

## 6단계: 거래 실행
${cd} && bun run skills/trader/scripts/execute-trade.ts

## 7단계: 결과 보고
승인/거부 종목별 기술적+심리적 판단 근거를 상세히 설명해.`;
			break;
		}
		case 'status':
			prompt = '현재 투자 현황 알려줘. 포지션, 잔고, 오늘 PnL, 전략 상태 포함해서 보고해줘.';
			break;
		default:
			prompt = action;
	}

	// 이전 출력 파일 초기화
	writeFileSync(OUTPUT_FILE, '');

	try {
		const proc = Bun.spawn([bin, 'agent', '--agent', 'main', '--message', prompt], {
			cwd: PROJECT_ROOT,
			stdout: Bun.file(OUTPUT_FILE),
			stderr: Bun.file(OUTPUT_FILE),
			env: { ...process.env },
			stdin: 'ignore',
		});

		const statusData: OpenClawStatus = {
			state: 'running',
			pid: proc.pid,
			action,
			prompt,
			startedAt: new Date().toISOString(),
		};
		writeFileSync(STATUS_FILE, JSON.stringify(statusData));

		// 완료 시 상태 업데이트 (백그라운드)
		proc.exited.then((exitCode) => {
			try {
				const existing: OpenClawStatus = JSON.parse(readFileSync(STATUS_FILE, 'utf-8'));
				existing.state = exitCode === 0 ? 'done' : 'failed';
				existing.exitCode = exitCode ?? undefined;
				existing.completedAt = new Date().toISOString();
				writeFileSync(STATUS_FILE, JSON.stringify(existing));
			} catch { /* ignore */ }
		});

		return json({ success: true, pid: proc.pid });
	} catch (err) {
		return json({
			success: false,
			error: err instanceof Error ? err.message : String(err),
		});
	}
};
