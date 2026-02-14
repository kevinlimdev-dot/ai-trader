# 05 - wallet-manager 스킬 (지갑 관리)

## 1. 개요

`wallet-manager` 스킬은 코인베이스 Agentic Wallet을 통해 자금을 관리한다. 잔고 모니터링, 코인베이스 ↔ 하이퍼리퀴드 자금 이동, 보안 가드레일을 담당한다.

---

## 2. SKILL.md

```markdown
---
name: wallet-manager
description: 코인베이스 Agentic Wallet과 하이퍼리퀴드 잔고를 관리하고 자금 이동을 처리합니다.
metadata: {"openclaw":{"requires":{"bins":["bun"]},"primaryEnv":"COINBASE_API_KEY"}}
---

## 목적

코인베이스 Agentic Wallet과 하이퍼리퀴드 거래 계좌의 잔고를 모니터링하고,
필요 시 자금을 이동합니다.

## 사용 시나리오

- 사용자가 "잔고 확인해", "코인베이스에서 하이퍼리퀴드로 500 USDC 보내줘" 요청 시
- trader 스킬에서 잔고 부족으로 자금 요청이 발생했을 때
- cron 작업에서 주기적 잔고 확인 시

## 실행 방법

잔고 조회:
```
bun run {baseDir}/scripts/manage-wallet.ts --action balance
```

자금 충전 (코인베이스 → 하이퍼리퀴드):
```
bun run {baseDir}/scripts/manage-wallet.ts --action fund --amount 500
```

자금 인출 (하이퍼리퀴드 → 코인베이스):
```
bun run {baseDir}/scripts/manage-wallet.ts --action withdraw --amount 500
```

대기 중인 자금 요청 처리:
```
bun run {baseDir}/scripts/manage-wallet.ts --action process-requests
```

일일 리포트:
```
bun run {baseDir}/scripts/manage-wallet.ts --action daily-report
```

## 출력

- stdout에 잔고/전송 결과 JSON
- SQLite `wallet_transfers` 테이블에 이동 기록
- SQLite `balance_snapshots` 테이블에 잔고 스냅샷

## 보안

- 모든 전송은 화이트리스트 주소로만 가능
- 단일 전송 최대 1,000 USDC
- 일일 전송 최대 5,000 USDC
- 코인베이스/하이퍼리퀴드 최소 보유 잔고 강제

## 설정

`config.yaml`의 `wallet_agent` 섹션 참조.
```

---

## 3. 코인베이스 Agentic Wallet 연동

```typescript
const BASE_URL = "https://api.cdp.coinbase.com/v2";
const headers = {
  Authorization: `Bearer ${process.env.COINBASE_API_KEY}`,
  "Content-Type": "application/json",
  "X-Wallet-Secret": process.env.COINBASE_WALLET_SECRET!,
};

// 잔고 조회
const balances = await fetch(`${BASE_URL}/wallets/${walletId}/balances`, { headers });

// USDC 전송 (하이퍼리퀴드로)
const tx = await fetch(`${BASE_URL}/wallets/${walletId}/send`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    currency: "USDC",
    amount: "500",
    to_address: process.env.HYPERLIQUID_DEPOSIT_ADDRESS,
    network: "arbitrum",
  }),
});
```

---

## 4. 보안 가드레일

| 한도 항목 | 기본값 | 설명 |
|----------|--------|------|
| `max_single_transfer` | 1,000 USDC | 단일 전송 최대 |
| `max_daily_transfer` | 5,000 USDC | 일일 전송 최대 |
| `min_reserve_coinbase` | 500 USDC | 코인베이스 최소 보유 |
| `min_reserve_hyperliquid` | 200 USDC | 하이퍼리퀴드 최소 보유 |

모든 전송 전 화이트리스트 주소 확인 + 한도 검증 + 최소 잔고 체크 수행.

---

## 5. 설정 (config.yaml)

```yaml
wallet_agent:
  monitoring:
    balance_check_interval_sec: 30
    low_balance_alert_usdc: 300
  coinbase:
    base_url: "https://api.cdp.coinbase.com/v2"
    transfer_network: "arbitrum"
  transfers:
    max_single_transfer: 1000
    max_daily_transfer: 5000
    auto_fund_enabled: true
    auto_fund_buffer_pct: 0.20
  security:
    min_reserve_coinbase: 500
    min_reserve_hyperliquid: 200
    whitelist: []   # .env에서 주소 로드
```

---

## 6. 스크립트 구조

```
skills/wallet-manager/
├── SKILL.md
└── scripts/
    └── manage-wallet.ts

src/services/
└── coinbase.service.ts
```

---

## 관련 문서

- [04-trade-agent.md](./04-trade-agent.md) — trader 스킬 (자금 요청자)
- [06-config-and-deployment.md](./06-config-and-deployment.md) — 전체 설정
