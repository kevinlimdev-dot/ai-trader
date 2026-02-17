# 07 - 데이터 흐름 및 오케스트레이션

## 1. 개요

이 문서는 OpenClaw Gateway 기반으로 4개 스킬이 어떻게 협업하는지, cron/sub-agent 기반 오케스트레이션, 파일 기반 데이터 교환, 에러 처리를 기술한다.

---

## 2. 오케스트레이션 모델

OpenClaw에서 에이전트 오케스트레이션은 두 가지 방식으로 이루어진다:

### 2.1 Cron 기반 (자동 루프)

Gateway 내장 cron이 주기적으로 **isolated session**을 생성하고, 에이전트가 스킬을 순차적으로 호출한다.

```
[Cron Job: Trading Loop - 5분 간격]
     │
     ▼
  Isolated Session 생성
     │
     ▼
  에이전트가 ai-trader 스킬에 따라 7단계 실행:
     │
     ├── 1. exec "bun run skills/data-collector/scripts/collect-prices.ts"
     │     └── 출력: data/snapshots/latest.json
     │
     ├── 2. exec "bun run skills/analyzer/scripts/analyze.ts"
     │     └── 입력: data/snapshots/latest.json
     │     └── 출력: data/signals/latest.json (전략 프리셋 적용)
     │
     ├── 3. exec "bun run skills/ai-decision/scripts/collect-sentiment.ts"
     │     └── 바이낸스: OI, 롱/숏 비율, 탑 트레이더, 테이커, 펀딩비
     │     └── 하이퍼리퀴드: 펀딩비, OI, 프리미엄, 거래량
     │     └── 출력: data/sentiment/latest.json (실패해도 계속)
     │
     ├── 4. ★ AI 자율 투자 판단 ★
     │   exec "bun run skills/ai-decision/scripts/summarize.ts"
     │     └── 기술적 분석 + 시장 심리 + 포지션 + 잔고 종합 요약
     │   에이전트가 데이터 분석 후 독립적으로 투자 결정
     │   exec "bun run skills/ai-decision/scripts/apply-decision.ts --decisions '<JSON>'"
     │     └── 승인/거부 결과를 data/signals/latest.json에 반영
     │
     ├── 5. exec "bun run skills/wallet-manager/scripts/manage-wallet.ts --action auto-rebalance"
     │     └── Coinbase ↔ HyperLiquid 잔고 리밸런싱 (실패해도 계속)
     │
     ├── 6. exec "bun run skills/trader/scripts/execute-trade.ts"
     │     └── 입력: data/signals/latest.json (AI 필터링 완료)
     │     └── 출력: SQLite 저장 + stdout 결과
     │
     └── 7. 결과를 Telegram으로 보고 (AI 판단 근거 포함)

[독립 프로세스 — Position Monitor]
     │
     ├── Runner가 거래 실행 후 자동 시작 (ensureMonitorRunning)
     ├── 15초 주기로 열린 포지션 체크
     ├── SL/TP/트레일링 스탑 조건 충족 시 즉시 청산
     └── 포지션 없으면 20 idle 사이클(~5분) 후 자동 종료
```

### 2.2 대시보드 기반 (Run All)

웹 대시보드의 **자동매매 시작** 버튼 또는 **1회 실행** 버튼으로 7단계 파이프라인을 실행한다. OpenClaw 에이전트 모드 또는 직접 `Bun.spawn` 모드로 실행한다.

```
[대시보드 — 실행 모드 2가지]

A. OpenClaw 에이전트 모드 (OpenClaw 데몬 연결 시):
     │
     ▼
  SvelteKit API → /api/bot/runner (start/once)
     │
     ▼
  src/runner.ts → openclaw agent --agent main --message <7단계 파이프라인 프롬프트>
     │
     ├── OpenClaw AI가 7단계 순차 실행 (4단계에서 자율 판단)
     └── 실시간 출력 → /tmp/ai-trader-openclaw-output.txt
     │
     ▼
  거래 완료 후 → ensureMonitorRunning() → position-monitor.ts 자동 시작

B. 직접 실행 모드 (OpenClaw 미연결 시 fallback 또는 --direct):
     │
     ▼
  src/runner.ts → Bun.spawn 순차 실행
     │
     ├── step 1: collect-prices.ts        → 성공/실패 (critical)
     ├── step 2: analyze.ts               → 성공/실패 (critical)
     ├── step 3: collect-sentiment.ts     → 실패해도 계속
     ├── step 4: summarize.ts             → 실패해도 계속
     ├── step 5: manage-wallet.ts         → 실패해도 계속
     └── step 6: execute-trade.ts         → 성공/실패
     │
     ▼
  거래 완료 후 → ensureMonitorRunning() → position-monitor.ts 자동 시작
```

> **Note:** 직접 실행 모드에서는 AI 자율 판단(4단계)의 `summarize.ts`만 실행되고, OpenClaw AI의 독립적 판단과 `apply-decision.ts` 호출은 생략된다. OpenClaw 에이전트 모드에서만 완전한 AI 판단이 이루어진다.

### 2.3 대화 기반 (텔레그램)

텔레그램 봇(`@aiiiiitrading_bot`)에서 사용자가 자연어로 명령하면, 에이전트가 `ai-trader` 스킬의 명령어 매핑에 따라 적절한 스크립트를 호출한다.

```
사용자 (Telegram): "잔고"
     │
     ▼
  OpenClaw Gateway → 에이전트 세션
     │
     ▼
  에이전트: ai-trader 스킬 SKILL.md의 명령어 매핑 참조
     │
     ▼
  exec "bun run skills/wallet-manager/scripts/manage-wallet.ts --action balance"
     │
     ▼
  결과를 텔레그램으로 응답 (streamMode: block)
```

지원되는 텔레그램 명령 예시:

| 명령 | 실행 스크립트 |
|------|-------------|
| "자동매매 시작" | Runner start → 7단계 반복 |
| "포지션" | execute-trade.ts --action positions |
| "잔고" | manage-wallet.ts --action balance |
| "긴급 청산" | execute-trade.ts --action emergency |
| "일일요약" | execute-trade.ts --action daily-summary |

### 2.4 Sub-Agent (병렬 처리)

필요 시 `sessions_spawn`으로 백그라운드 작업을 병렬로 실행한다.

```
메인 에이전트:
  ├── sessions_spawn: "data-collector로 BTC 수집"
  ├── sessions_spawn: "data-collector로 ETH 수집"
  └── sessions_spawn: "wallet-manager로 잔고 확인"

  (각각 독립적으로 실행 후 결과 announce)
```

---

## 3. 데이터 교환 메커니즘

### 3.1 파일 기반 (스킬 간)

스킬 간 데이터 교환은 JSON 파일을 통해 이루어진다.

```
data/
├── snapshots/
│   └── latest.json     # data-collector → analyzer
├── signals/
│   └── latest.json     # analyzer → ai-decision → trader
├── sentiment/
│   └── latest.json     # collect-sentiment → summarize (시장 심리)
└── fund-requests/
    └── latest.json     # trader → wallet-manager (자금 요청 시)
```

### Atomic Write (안전한 파일 쓰기)

```typescript
import { rename } from "fs/promises";

async function atomicWrite(filepath: string, data: unknown): Promise<void> {
  const tmpPath = `${filepath}.tmp.${Date.now()}`;
  await Bun.write(tmpPath, JSON.stringify(data, null, 2));
  await rename(tmpPath, filepath);
}
```

### 3.2 SQLite 기반 (영속 데이터)

```
data/ai-trader.db
├── snapshots      # 가격 이력
├── trades         # 거래 이력
├── wallet_transfers  # 자금 이동 이력
└── balance_snapshots # 잔고 스냅샷
```

### 3.3 프로세스 간 통신 (IPC — 파일 기반)

Runner와 Position Monitor는 `/tmp` 디렉토리의 JSON 파일로 상태를 공유한다:

```
/tmp/
├── ai-trader-runner-status.json      # Runner 실행 상태 (state, cycle, nextRun 등)
├── ai-trader-runner-control.json     # Runner 제어 (stop/start 명령)
├── ai-trader-monitor-status.json     # Position Monitor 상태 (positions, checks 등)
├── ai-trader-monitor-control.json    # Position Monitor 제어 (stop 명령)
├── ai-trader-openclaw-output.txt     # OpenClaw 에이전트 실시간 출력
├── ai-trader-openclaw-status.json    # OpenClaw 실행 상태
└── ai-trader-awal-cache.json         # awal CLI 캐시 (잔고, 주소)
```

대시보드 SvelteKit API가 이 파일들을 읽어 UI에 실시간 반영한다.

### 3.4 stdout (스크립트 → 에이전트)

각 스크립트는 실행 결과를 stdout에 JSON으로 출력한다. OpenClaw 에이전트는 `exec` 도구의 반환값으로 이를 읽어 다음 판단에 활용한다.

```typescript
// 스크립트 끝에서
console.log(JSON.stringify({
  status: "success",
  signal: { action: "LONG", confidence: 0.78, symbol: "BTC" },
}));
```

---

## 4. 시퀀스 다이어그램

### 4.1 일반 트레이딩 루프 (7단계)

```
Runner (5분 주기) 또는 OpenClaw Agent:
  step 1 → exec:  bun run collect-prices.ts
  exec → File:    data/snapshots/latest.json 저장
  step 2 → exec:  bun run analyze.ts (전략 프리셋 적용)
  exec → File:    data/signals/latest.json 저장
  step 3 → exec:  bun run collect-sentiment.ts
  exec → File:    data/sentiment/latest.json 저장 (실패해도 계속)
  step 4:         ★ AI 자율 투자 판단 (OpenClaw 모드) ★
    → exec:       bun run summarize.ts
    AI 분석:      기술적 지표 + 시장 심리 종합 판단
    → exec:       bun run apply-decision.ts --decisions '<JSON>'
    exec → File:  data/signals/latest.json 수정 (AI 필터링)
  step 5 → exec:  bun run manage-wallet.ts --action auto-rebalance
  exec:           잔고 체크 + 리밸런싱 (실패해도 계속)
  step 6:         거래 실행
    → exec:       bun run execute-trade.ts (AI 승인 시그널만 실행)
    exec → HL API: 주문 실행
    exec → SQLite: 거래 기록 저장
  step 7:         결과 보고 (AI 판단 근거 포함)

  Runner → ensureMonitorRunning()
  → position-monitor.ts 백그라운드 시작 (15초 주기 SL/TP 체크)
```

### 4.2 자동 리밸런싱

```
Agent/Dashboard → exec:  bun run manage-wallet.ts --action auto-rebalance
exec:            Coinbase 잔고 = 2,000 USDC, HL 잔고 = 150 USDC (< min 200)
exec:            충전 필요량 계산: 200 * 1.2 (buffer) - 150 = 90 USDC
exec → Coinbase: 90 USDC → HL 전송 요청
exec:            { status: "rebalanced", direction: "coinbase→hl", amount: 90 }
```

### 4.3 잔고 부족 시 (수동 충전)

```
Agent → exec:     bun run execute-trade.ts
exec:             잔고 부족 감지, { status: "insufficient_balance", needed: 500 }
Agent:            wallet-manager 스킬 호출 결정
Agent → exec:     bun run manage-wallet.ts --action fund --amount 500
exec → Coinbase:  500 USDC 전송 요청
exec → Agent:     { status: "funded", amount: 500 }
Agent → exec:     bun run execute-trade.ts  (재시도)
```

### 4.4 Arbitrum → HyperLiquid 입금

```
대시보드 또는 CLI → deposit-to-hl.ts
exec:            Arbitrum ETH 잔고 확인 (가스비용)
exec:            Arbitrum USDC 잔고 확인
exec:            ERC20 transfer → HL Bridge2 (0x2Df1...dF7)
exec → Arbitrum: 트랜잭션 전송 + 컨펌 대기
exec:            { status: "deposited", amount: "1000.00", txHash: "0x..." }
                 → ~1분 내 HyperLiquid Spot 계정 입금 완료
                 → Unified Account: Spot USDC가 Perps 마진으로 자동 활용
```

### 4.5 AI 자율 투자 판단

```
[4단계: AI 자율 판단 — OpenClaw 에이전트 모드]

1. summarize.ts 실행 → 종합 요약 JSON 생성:
   ├── 기술적 분석 (data/signals/latest.json)
   ├── 시장 심리 (data/sentiment/latest.json)
   ├── 현재 포지션 (HyperLiquid API)
   └── 잔고 정보

2. OpenClaw AI가 요약을 분석:
   ├── composite_score + 개별 지표 일치 여부
   ├── crowd_bias: 군중 편향 → 역발상 검토
   ├── smart_money: 탑 트레이더 방향 추종
   ├── funding_rate: 극단적이면 반대 포지션 유리
   ├── open_interest: 스퀴즈 가능성 판단
   └── taker_pressure: 단기 모멘텀 파악

3. AI가 decisions JSON 생성:
   [{"symbol":"BTC","action":"LONG","confidence":0.7,
     "reason":"RSI 반등 + 스마트머니 롱 + 군중 숏(역발상) + 펀딩비 음수"},
    {"symbol":"ETH","action":"HOLD",
     "reason":"군중+스마트머니 모두 롱 → 과열 위험"}]

4. apply-decision.ts 실행:
   ├── AI 승인 종목: action 유지 + ai_reviewed: true
   ├── AI 거부 종목: action → "HOLD" + ai_reason 기록
   └── data/signals/latest.json 수정 완료
```

### 4.6 포지션 모니터링 (독립 프로세스)

```
[position-monitor.ts 시작]
Loop:
  exec → HL API:  열린 포지션 조회
  exec → HL API:  현재 가격 조회
  exec:           SL/TP/트레일링 스탑 조건 체크
    [SL 도달]    → HL API: 시장가 청산 → SQLite 기록
    [TP 도달]    → HL API: 시장가 청산 → SQLite 기록
    [Trailing]   → peakPnl 업데이트, drawdown 체크
  exec:           /tmp/ai-trader-monitor-status.json 업데이트
  sleep 15초
  [포지션 없으면 idleCycles++ → 20회(~5분) 후 자동 종료]
```

### 4.7 긴급 상황

```
[1분 내 BTC -5% 급락 감지]
Agent → exec:     bun run execute-trade.ts --action emergency
exec:             KILL_SWITCH 파일 생성
exec → HL API:    모든 포지션 시장가 청산
exec → SQLite:    비상 청산 기록
Agent → Telegram: "비상 청산 완료. KILL_SWITCH 활성화. 수동 해제 필요."
```

---

## 5. 에러 처리

### 5.1 스크립트 레벨

각 스크립트는 exit code와 JSON 출력으로 에러를 보고한다:

```typescript
// 에러 시 exit code 1 + JSON 출력
try {
  // ... 작업 실행
} catch (error) {
  console.error(JSON.stringify({
    status: "error",
    error: error instanceof Error ? error.message : "Unknown error",
    retryable: true,
  }));
  process.exit(1);
}
```

### 5.2 에이전트 레벨

`exec` 도구가 exit code ≠ 0 을 반환하면, 에이전트가 에러를 분석하고:
- `retryable: true`이면 재시도 (최대 3회)
- 그래도 실패하면 에러 내용을 Telegram/Discord로 알림
- 치명적 에러 (잔고 부족, API 키 만료 등)는 즉시 알림 후 루프 중단

### 5.3 Gateway 레벨

OpenClaw Gateway 자체의 안정성:
- launchd/systemd 서비스로 자동 재시작
- `openclaw health`로 상태 모니터링
- cron 작업은 Gateway 재시작 후에도 유지 (`~/.openclaw/cron/jobs.json`)

---

## 6. 타이밍

| 작업 | 주기 | 방식 |
|------|------|------|
| 트레이딩 파이프라인 | 5분 (300초) | Runner (src/runner.ts) |
| 포지션 모니터링 | 15초 | 독립 프로세스 (src/position-monitor.ts) |
| 잔고 체크 | 5분 | cron (isolated) |
| 일일 리포트 | 매일 22:00 KST | cron (isolated + announce) |
| 긴급 알림 | 즉시 | 에이전트 판단 |
| 사용자 명령 | 온디맨드 | Telegram/Discord 메시지 |

---

## 7. 페이퍼/라이브 트레이딩 모드

### 7.1 모드 전환

`config.yaml`의 `general.mode` 값으로 제어하며, **대시보드에서 실시간 전환이 가능**하다.

| 모드 | 동작 | 대시보드 표시 |
|------|------|--------------|
| `paper` | 가상 주문 실행, DB에 `paper_` 접두사로 기록 | 녹색 "PAPER" 배지 |
| `live` | 실제 HyperLiquid 주문 실행 | 빨간색 "LIVE" 배지 |

### 7.2 Paper 모드 동작

```typescript
if (config.general.mode === "paper") {
  // 가상 주문 실행 (수수료 시뮬레이션: 0.05%)
  const paperResult = {
    status: "paper_executed",
    side: signal.action,
    entry_price: signal.entry_price,
    size: calculatedSize,
    simulated: true,
  };
  // SQLite에 paper_ 접두사로 기록
  db.run(
    `INSERT INTO trades (trade_id, ..., status) VALUES (?, ..., 'paper')`,
    [`paper_${Date.now()}`, ...]
  );
} else {
  // 실제 주문 실행
  await walletClient.order({ ... });
}
```

### 7.3 대시보드에서 모드 전환

```
대시보드 토글 클릭 → POST /api/mode { mode: "live" }
     │
     ▼
SvelteKit API → config.yaml 파일의 general.mode 업데이트
     │
     ▼
다음 파이프라인 실행 시 새 모드 적용
```

---

## 8. 모니터링

### 8.1 웹 대시보드 (SvelteKit)

```bash
bun run dashboard
# http://localhost:5173
```

- **메인 대시보드**: KPI, 실시간 가격, 잔고, 입금 지갑 주소, 파이프라인 실행
- **포지션**: 열린 포지션 관리 (청산/수정)
- **거래 내역**: 전체 거래 이력 + 필터링
- **시그널**: 분석 결과 상세 (차트 + 지표)
- **지갑**: 잔고 현황 + 입금 안내
- **봇 제어**: 개별 스크립트 실행/중지, Kill Switch

상세 스펙은 [08-dashboard.md](./08-dashboard.md) 참조.

### 8.2 OpenClaw 대시보드

```bash
openclaw dashboard
# http://127.0.0.1:18789
```

- 에이전트 상태, 세션 히스토리, cron 작업 이력

### 8.3 Telegram 알림 예시

```
📊 [Trading Loop 결과]
━━━━━━━━━━━━━━━━━
BTC: LONG 진입
  진입가: $65,420.50
  수량: 0.015 BTC
  손절: $65,100.00
  익절: $65,900.00
  신뢰도: 78%

ETH: HOLD (진입 조건 미충족)
  복합 점수: 0.32

💰 계좌 현황
  HyperLiquid: 4,250 USDC
  Coinbase: 2,500 USDC
━━━━━━━━━━━━━━━━━
```

---

## 관련 문서

- [01-overview.md](./01-overview.md) — 시스템 아키텍처
- [06-config-and-deployment.md](./06-config-and-deployment.md) — 설정 전체
- [08-dashboard.md](./08-dashboard.md) — 웹 대시보드 상세 스펙
- [10-ai-decision.md](./10-ai-decision.md) — AI 자율 투자 판단 시스템
- [11-telegram.md](./11-telegram.md) — 텔레그램 연동
