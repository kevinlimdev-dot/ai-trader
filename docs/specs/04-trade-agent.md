# 04 - trader 스킬 (거래 실행)

## 1. 개요

`trader` 스킬은 매매 시그널을 검증하고 하이퍼리퀴드에서 주문을 실행한다. 포지션 관리, 리스크 관리, 트레일링 스탑, 긴급 청산(Kill Switch) 기능을 포함한다.

---

## 2. SKILL.md

```markdown
---
name: trader
description: 매매 시그널을 검증하고 하이퍼리퀴드에서 주문을 실행하며 포지션을 관리합니다. 긴급 청산 기능을 포함합니다.
metadata: {"openclaw":{"requires":{"bins":["bun"]},"primaryEnv":"HYPERLIQUID_PRIVATE_KEY"}}
---

## 목적

`data/signals/latest.json`의 매매 시그널을 읽고, 리스크 규칙을 검증한 뒤
하이퍼리퀴드에서 실제 주문을 실행합니다. 결과는 SQLite DB에 기록합니다.

## 사용 시나리오

- cron 트레이딩 루프에서 analyzer 다음에 호출
- 사용자가 "지금 BTC 롱 진입해", "전체 포지션 청산해" 요청 시
- "현재 포지션 보여줘", "오늘 수익 얼마야?" 등 조회 시

## 실행 방법

주문 실행 (시그널 기반):
```
bun run {baseDir}/scripts/execute-trade.ts
```

포지션 모니터링 (SL/TP/트레일링 스탑 체크):
```
bun run {baseDir}/scripts/execute-trade.ts --action monitor
```

포지션 조회:
```
bun run {baseDir}/scripts/execute-trade.ts --action positions
```

전체 포지션 청산:
```
bun run {baseDir}/scripts/execute-trade.ts --action close-all --reason manual
```

긴급 청산 (Kill Switch):
```
bun run {baseDir}/scripts/execute-trade.ts --action emergency
```

일일 요약:
```
bun run {baseDir}/scripts/execute-trade.ts --action daily-summary
```

## 입력

- `data/signals/latest.json` — 최신 매매 시그널

## 출력

- SQLite `trades` 테이블에 거래 기록 (SL/TP/peak_pnl_pct/trailing_activated 포함)
- `data/fund-requests/latest.json` — 잔고 부족 시 자금 요청 자동 생성
- stdout에 실행 결과 JSON

## 안전장치

- `data/KILL_SWITCH` 파일 존재 시 모든 거래 즉시 중지 후 전량 청산
- 일일 최대 손실(5%) 초과 시 자동 중지
- 연속 API 에러 5회 시 비상 중지
- 1분 내 5% 이상 급변 시 비상 모드

## 리스크 규칙

- 거래당 최대 리스크: 잔고의 2%
- 최대 포지션: 잔고의 10%
- 동시 포지션: 최대 3개
- 일일 최대 거래: 50회
- 기본 레버리지: 5x (최대 10x)

## 설정

`config.yaml`의 `trade_agent` 섹션 참조.
```

---

## 3. 하이퍼리퀴드 SDK 연동

```typescript
import { HttpTransport, WalletClient, PublicClient } from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount(process.env.HYPERLIQUID_PRIVATE_KEY as `0x${string}`);
const transport = new HttpTransport({ url: "https://api.hyperliquid.xyz" });
const walletClient = new WalletClient({ wallet: account, transport });
const publicClient = new PublicClient({ transport });

// 주문 실행
await walletClient.order({
  orders: [{
    coin: "BTC", isBuy: true, sz: "0.01",
    limitPx: "0", orderType: { market: {} }, reduceOnly: false,
  }],
  grouping: "na",
});

// 포지션 조회
const state = await publicClient.clearinghouseState({ user: account.address });
```

---

## 4. 리스크 관리

### 포지션 크기 계산

```typescript
function calculatePositionSize(params: {
  balance: number;
  riskPerTrade: number;    // 0.02
  entryPrice: number;
  stopLoss: number;
  leverage: number;
  maxPositionPct: number;  // 0.10
}): number {
  const riskAmount = params.balance * params.riskPerTrade;
  const stopDistance = Math.abs(params.entryPrice - params.stopLoss) / params.entryPrice;
  const positionSize = (riskAmount / stopDistance) / params.entryPrice;
  const maxSize = (params.balance * params.maxPositionPct * params.leverage) / params.entryPrice;
  return Math.min(positionSize, maxSize);
}
```

### 트레일링 스탑

- 수익 1.5% 이상에서 활성화
- 최고점 대비 0.8% 하락 시 청산

### 긴급 청산 조건

1. `data/KILL_SWITCH` 파일 존재
2. 일일 손실 한도 초과
3. 잔고 최소값(100 USDC) 미달
4. 연속 API 에러 5회 이상
5. 1분 내 5% 이상 급변

---

## 5. SQLite 스키마

```sql
CREATE TABLE trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_id TEXT UNIQUE NOT NULL,
  timestamp_open TEXT NOT NULL,
  timestamp_close TEXT,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  entry_price REAL NOT NULL,
  exit_price REAL,
  size REAL NOT NULL,
  leverage INTEGER NOT NULL,
  pnl REAL,
  pnl_pct REAL,
  fees REAL,
  exit_reason TEXT,
  signal_confidence REAL,
  status TEXT DEFAULT 'open',
  created_at TEXT DEFAULT (datetime('now'))
);
```

---

## 6. 설정 (config.yaml)

```yaml
trade_agent:
  hyperliquid:
    base_url: "https://api.hyperliquid.xyz"
    slippage: 0.01
  leverage: { default: 5, max: 10 }
  risk:
    risk_per_trade: 0.02
    max_position_pct: 0.10
    max_daily_loss: 0.05
    max_concurrent_positions: 3
    max_daily_trades: 50
    min_balance_usdc: 100
    min_signal_confidence: 0.4
  trailing_stop:
    enabled: true
    activation_pct: 1.5
    trail_pct: 0.8
  safety:
    kill_switch_file: "data/KILL_SWITCH"
    max_consecutive_api_errors: 5
    price_anomaly_threshold: 5.0
```

---

## 7. 스크립트 구조

```
skills/trader/
├── SKILL.md
└── scripts/
    └── execute-trade.ts

src/services/
└── hyperliquid.service.ts

src/utils/
└── risk-manager.ts
```

---

## 관련 문서

- [03-analysis-agent.md](./03-analysis-agent.md) — analyzer 스킬 (시그널 제공자)
- [05-wallet-agent.md](./05-wallet-agent.md) — wallet-manager 스킬 (자금 관리)
