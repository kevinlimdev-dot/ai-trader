# 07 - 데이터 흐름 및 오케스트레이션

## 1. 개요

이 문서는 OpenClaw Gateway 기반으로 4개 스킬이 어떻게 협업하는지, cron/sub-agent 기반 오케스트레이션, 파일 기반 데이터 교환, 에러 처리를 기술한다.

---

## 2. 오케스트레이션 모델

OpenClaw에서 에이전트 오케스트레이션은 두 가지 방식으로 이루어진다:

### 2.1 Cron 기반 (자동 루프)

Gateway 내장 cron이 주기적으로 **isolated session**을 생성하고, 에이전트가 스킬을 순차적으로 호출한다.

```
[Cron Job: Trading Loop - 매 30초]
     │
     ▼
  Isolated Session 생성
     │
     ▼
  에이전트가 AGENTS.md 규칙에 따라:
     │
     ├── 1. exec "bun run skills/data-collector/scripts/collect-prices.ts"
     │     └── 출력: data/snapshots/latest.json
     │
     ├── 2. exec "bun run skills/analyzer/scripts/analyze.ts"
     │     └── 입력: data/snapshots/latest.json
     │     └── 출력: data/signals/latest.json
     │
     ├── 3. exec "bun run skills/wallet-manager/scripts/manage-wallet.ts --action auto-rebalance"
     │     └── Coinbase ↔ HyperLiquid 잔고 리밸런싱 (실패해도 계속)
     │
     ├── 4. (시그널이 LONG/SHORT인 경우)
     │   exec "bun run skills/trader/scripts/execute-trade.ts"
     │     └── 입력: data/signals/latest.json
     │     └── 출력: SQLite 저장 + stdout 결과
     │
     ├── 5. exec "bun run skills/trader/scripts/execute-trade.ts --action monitor"
     │     └── 포지션 SL/TP/트레일링 스탑 체크
     │
     └── 결과를 Telegram으로 announce
```

### 2.2 대시보드 기반 (Run All)

웹 대시보드의 **Run All** 버튼으로 동일한 5단계 파이프라인을 수동 실행한다. `Bun.spawn`으로 각 스크립트를 순차 실행하며, 진행 상황이 실시간으로 UI에 반영된다.

```
[대시보드 Run All 클릭]
     │
     ▼
  SvelteKit API → bot.ts runPipeline()
     │
     ├── step 1: Bun.spawn("bun run collect")    → 성공/실패 반환
     ├── step 2: Bun.spawn("bun run analyze")    → 성공/실패 반환
     ├── step 3: Bun.spawn("bun run auto-rebalance") → 실패해도 계속
     ├── step 4: Bun.spawn("bun run trade")      → 성공/실패 반환
     └── step 5: Bun.spawn("bun run monitor")    → 성공/실패 반환
     │
     ▼
  대시보드에 각 단계 결과 표시 (✅/❌ + 소요 시간)
```

### 2.3 대화 기반 (사용자 명령)

Telegram/Discord에서 사용자가 직접 명령하면, 에이전트가 적절한 스킬을 호출한다.

```
사용자: "현재 BTC 포지션 보여줘"
     │
     ▼
  OpenClaw Gateway → 에이전트 세션
     │
     ▼
  에이전트: trader 스킬 SKILL.md 참조
     │
     ▼
  exec "bun run skills/trader/scripts/execute-trade.ts --action positions"
     │
     ▼
  결과를 사용자에게 응답
```

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
│   └── latest.json     # analyzer → trader
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

### 3.3 stdout (스크립트 → 에이전트)

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

### 4.1 일반 트레이딩 루프

```
Cron → Gateway:  "트레이딩 루프 실행"
Gateway → Agent:  Isolated session 생성
Agent → exec:     bun run collect-prices.ts
exec → File:      data/snapshots/latest.json 저장
Agent → exec:     bun run analyze.ts
exec → File:      data/signals/latest.json 저장
Agent:            시그널 확인 (LONG/SHORT?)
  [LONG or SHORT인 경우]
  Agent → exec:   bun run execute-trade.ts
  exec → HL API:  주문 실행
  exec → SQLite:  거래 기록 저장
  Agent → Telegram: "BTC LONG 진입 @ 65,420"
  [HOLD인 경우]
  Agent:          "진입 조건 미충족, 대기"
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

### 4.4 긴급 상황

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
| 트레이딩 루프 | 30초 | cron (isolated) |
| 포지션 모니터링 | 10초 | cron (isolated) |
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
