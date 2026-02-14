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
     ├── exec "bun run skills/data-collector/scripts/collect-prices.ts"
     │     └── 출력: data/snapshots/latest.json
     │
     ├── exec "bun run skills/analyzer/scripts/analyze.ts"
     │     └── 입력: data/snapshots/latest.json
     │     └── 출력: data/signals/latest.json
     │
     ├── (시그널이 LONG/SHORT인 경우)
     │   exec "bun run skills/trader/scripts/execute-trade.ts"
     │     └── 입력: data/signals/latest.json
     │     └── 출력: SQLite 저장 + stdout 결과
     │
     └── 결과를 Telegram으로 announce
```

### 2.2 대화 기반 (사용자 명령)

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

### 2.3 Sub-Agent (병렬 처리)

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

### 4.2 잔고 부족 시

```
Agent → exec:     bun run execute-trade.ts
exec:             잔고 부족 감지, { status: "insufficient_balance", needed: 500 }
Agent:            wallet-manager 스킬 호출 결정
Agent → exec:     bun run manage-wallet.ts --action fund --amount 500
exec → Coinbase:  500 USDC 전송 요청
exec → Agent:     { status: "funded", amount: 500 }
Agent → exec:     bun run execute-trade.ts  (재시도)
```

### 4.3 긴급 상황

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

## 7. 페이퍼 트레이딩

`config.yaml`에서 `general.mode: "paper"`로 설정하면, trader 스킬이 실제 API 대신 시뮬레이션 모드로 동작한다.

```typescript
// execute-trade.ts 내부
const config = loadConfig();

if (config.general.mode === "paper") {
  // 가상 주문 실행
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
  console.log(JSON.stringify(paperResult));
} else {
  // 실제 주문 실행
  await walletClient.order({ ... });
}
```

---

## 8. 모니터링 대시보드

### 8.1 OpenClaw 대시보드

```bash
openclaw dashboard
# http://127.0.0.1:18789
```

- 실시간 에이전트 상태
- 세션 히스토리 (트레이딩 루프 결과)
- cron 작업 목록 및 실행 이력

### 8.2 Telegram 알림 예시

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
