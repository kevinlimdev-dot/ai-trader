# 05 - wallet-manager 스킬 (지갑 관리)

## 1. 개요

`wallet-manager` 스킬은 코인베이스 Agentic Wallet(`awal` CLI)을 통해 자금을 관리한다. 잔고 모니터링, 코인베이스 ↔ 하이퍼리퀴드 자금 이동, 보안 가드레일을 담당한다.

---

## 2. SKILL.md

```markdown
---
name: wallet-manager
description: 코인베이스 Agentic Wallet(awal CLI)과 하이퍼리퀴드 잔고를 관리하고 자금 이동을 처리합니다.
metadata: {"openclaw":{"requires":{"bins":["bun","npx"]}}}
---

## 목적

코인베이스 Agentic Wallet과 하이퍼리퀴드 거래 계좌의 잔고를 모니터링하고,
필요 시 자금을 이동합니다.

## 사용 시나리오

- 사용자가 **HyperLiquid에 Arbitrum USDC를 직접 입금**하면 즉시 거래 가능
- Coinbase Agentic Wallet에 USDC를 입금한 경우, 봇이 자동으로 HyperLiquid에 배분
- trader 스킬에서 잔고 부족으로 자금 요청이 발생했을 때 자동 충전
- 트레이딩 파이프라인에서 거래 전 자동 리밸런싱 (auto-rebalance)
- cron 작업에서 주기적 잔고 확인 시
- 사용자가 "잔고 확인해", "코인베이스에서 하이퍼리퀴드로 500 USDC 보내줘" 요청 시

## 실행 방법

잔고 조회:
\`\`\`
bun run {baseDir}/scripts/manage-wallet.ts --action balance
\`\`\`

자금 충전 (코인베이스 → 하이퍼리퀴드):
\`\`\`
bun run {baseDir}/scripts/manage-wallet.ts --action fund --amount 500
\`\`\`

자금 인출 (하이퍼리퀴드 → 코인베이스):
\`\`\`
bun run {baseDir}/scripts/manage-wallet.ts --action withdraw --amount 500
\`\`\`

대기 중인 자금 요청 처리:
\`\`\`
bun run {baseDir}/scripts/manage-wallet.ts --action process-requests
\`\`\`

자동 충전 (하이퍼리퀴드 잔고 부족 시 자동 입금):
\`\`\`
bun run {baseDir}/scripts/manage-wallet.ts --action auto-fund
\`\`\`

자동 리밸런싱 (Coinbase ↔ HyperLiquid 잔고 자동 조절):
\`\`\`
bun run {baseDir}/scripts/manage-wallet.ts --action auto-rebalance
\`\`\`

일일 리포트:
\`\`\`
bun run {baseDir}/scripts/manage-wallet.ts --action daily-report
\`\`\`

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

### 3.1 Agentic Wallet이란?

2026년 2월 출시된 코인베이스의 AI 에이전트 전용 지갑이다. 기존 CDP REST API 대신 **`awal` CLI**를 통해 제어한다.

| 항목 | 내용 |
|------|------|
| 인증 방식 | 이메일 OTP (API 키 불필요) |
| 네트워크 | **Base** (가스비 무료) |
| 지원 자산 | USDC, Base 네트워크 토큰 |
| 키 관리 | 코인베이스 인프라에서 관리 (에이전트는 키 접근 불가) |
| 보안 | KYT 스크리닝, 지출 한도, 가드레일 내장 |

### 3.2 초기 설정 (최초 1회)

```bash
# 1. 패키지 설치
bunx skills add coinbase/agentic-wallet-skills

# 2. 이메일 인증 시작
bunx awal auth login your@email.com

# 3. 이메일로 받은 6자리 코드로 인증 완료
bunx awal auth verify <flowId> <code>

# 4. 확인
bunx awal status
bunx awal address
bunx awal balance
```

### 3.3 코드에서 사용

`CoinbaseService`는 내부적으로 `Bun.spawn`으로 `awal` CLI를 호출한다.

```typescript
// src/services/coinbase.service.ts
const cb = new CoinbaseService();

// 인증 상태 확인
const status = await cb.checkStatus();
// { authenticated: true, email: "user@example.com" }

// 잔고 조회
const balance = await cb.getUsdcBalance();
// 1234.56

// 지갑 주소
const address = await cb.getAddress();
// "0x1234...abcd"

// USDC 전송
const result = await cb.sendUsdc({
  amount: 500,
  toAddress: "0xRecipient...",
});
// { status: "completed", txHash: "0x...", amount: "500", to: "0x..." }

// 하이퍼리퀴드로 자금 전송
await cb.fundHyperliquid(500);
```

### 3.4 네트워크 구조

```
사용자 ──Arbitrum USDC──→ HyperLiquid (Arbitrum)  ← 기본 입금 경로
                              ↑
Agentic Wallet (Base) ──send──┘  ← 자동 리밸런싱 경로 (Base→Arbitrum 크로스체인)
```

- **HyperLiquid**: **Arbitrum** 네트워크에서 입출금 (사용자 직접 입금 주소)
- **Agentic Wallet**: **Base** 네트워크에서 동작 (자동 리밸런싱 보조 지갑)
- 코인베이스 → 하이퍼리퀴드: Base에서 전송 시 크로스체인 브릿지가 필요할 수 있음
- 하이퍼리퀴드 → 코인베이스: HL은 Arbitrum으로 출금. 같은 EVM 주소이므로 수신 가능하지만, `awal balance`에는 Base 잔고만 표시됨

---

## 3.5 입금 방법

### 기본 입금: Arbitrum USDC → HyperLiquid (자동 입금 지원)

사용자가 **Arbitrum 네트워크**에 USDC를 보유하고 있으면, **자동 입금 스크립트**(`deposit-to-hl.ts`)를 통해 HyperLiquid Bridge2 컨트랙트에 전송하여 입금한다.

```
┌──────────────┐   Arbitrum USDC    ┌──────────────────┐    ~1분    ┌──────────────────┐
│   사용자 지갑  │ ─── deposit ──→  │  HL Bridge2       │ ────────→ │  HyperLiquid     │
│  (Arbitrum)   │                   │  (0x2Df1...dF7)   │           │  Spot 계좌        │
└──────────────┘                    └──────────────────┘           │  (Unified Account) │
                                                                    └──────────────────┘
```

- **네트워크**: Arbitrum One
- **토큰**: USDC (native, `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`)
- **Bridge 주소**: `0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7` (HL Deposit Bridge 2)
- **최소 입금**: 5 USDC
- **처리 시간**: ~1분
- **가스비**: Arbitrum ETH 소량 필요 (~0.001 ETH)
- **방법**: ERC20 `transfer`로 Bridge2 컨트랙트에 전송

#### CLI 사용법

```bash
# 전액 입금
bun run deposit

# 금액 지정
bun run deposit -- --amount 500

# 시뮬레이션 (실제 전송 없음)
bun run deposit -- --dry-run
```

#### Unified Account

HyperLiquid **Unified Account** 활성 시:
- 입금된 USDC는 **Spot 계정**에 들어감
- Spot USDC가 자동으로 Perps 마진으로 활용됨 → **별도 전송 불필요**
- `clearinghouseState.accountValue`에 Spot USDC가 이미 포함됨
- 잔고 조회 시 이중 계산 방지: `perpBalance > 0`이면 perpBalance가 총잔고

### 보조 입금: Coinbase Agentic Wallet 경유 (선택)

Coinbase Agentic Wallet에 USDC를 입금하면, 봇의 `auto-rebalance` 기능이 HyperLiquid로 자동 배분한다. 자동 리밸런싱이 필요한 경우에 활용한다.

```
┌──────────────┐   Base USDC    ┌──────────────────┐   auto-rebalance   ┌──────────────────┐
│   사용자       │ ── 입금 ──→  │  Coinbase Agentic  │ ───── 전송 ────→  │  HyperLiquid     │
│              │                │  Wallet (Base)     │                    │  거래 계좌        │
└──────────────┘                └──────────────────┘                    │  (Arbitrum)       │
                                                                        └──────────────────┘
```

- **네트워크**: Base
- **토큰**: USDC
- **입금 주소**: `bunx awal address`로 확인
- **가스비**: 무료 (Agentic Wallet 자체 제공)
- Base → Arbitrum 크로스체인 전송이 필요하므로 지연이 있을 수 있음

### 대시보드에서 입금 주소 표시

- **메인 대시보드**: "내 입금 지갑" 카드에 HyperLiquid 입금 주소 (Arbitrum) + Coinbase 주소 (Base) 표시 (복사 버튼 포함)
- **사이드바**: HyperLiquid 입금 주소 축약 표시 (클릭 시 복사)
- **지갑 페이지**: 상세 잔고 + 네트워크별 입금 안내

### 주소 조회

- **HyperLiquid 입금 주소**: `.env`의 `HYPERLIQUID_DEPOSIT_ADDRESS` (Arbitrum)
- **Coinbase 주소**: 서버에서 `bunx awal address` 명령으로 자동 조회, 5분간 캐시. `awal` CLI가 설정되어 있지 않으면 수동 확인 안내 표시

---

## 3.6 자동 리밸런싱 (auto-rebalance)

트레이딩 파이프라인의 3단계에서 거래 실행 전에 자동으로 호출된다.

### 리밸런싱 로직

```
1. Coinbase + HyperLiquid 잔고 조회
2. HyperLiquid 잔고가 min_reserve_hyperliquid 미만?
   → YES: Coinbase에서 자동 충전
3. HyperLiquid 잔고가 max_reserve_hyperliquid 초과?
   → YES: 초과분의 auto_withdraw_excess_pct만큼 Coinbase로 회수
4. 리밸런싱 결과를 DB에 기록
```

### 설정

```yaml
wallet_agent:
  transfers:
    auto_withdraw_excess_pct: 0.5   # 초과분의 50% 회수
  security:
    min_reserve_hyperliquid: 200    # HL 최소 보유
    max_reserve_hyperliquid: 3000   # HL 최대 보유 (초과 시 회수)
```

### 파이프라인 내 동작

- `auto-rebalance`가 실패하더라도 파이프라인은 계속 진행한다 (거래 실행에 영향 없음)
- 잔고 부족 시 거래 자체가 리스크 체크에서 차단됨

---

## 4. 보안 가드레일

| 한도 항목 | 기본값 | 설명 |
|----------|--------|------|
| `max_single_transfer` | 1,000 USDC | 단일 전송 최대 |
| `max_daily_transfer` | 5,000 USDC | 일일 전송 최대 |
| `min_reserve_coinbase` | 500 USDC | 코인베이스 최소 보유 |
| `min_reserve_hyperliquid` | 200 USDC | 하이퍼리퀴드 최소 보유 |

모든 전송 전 화이트리스트 주소 확인 + 한도 검증 + 최소 잔고 체크 수행.

추가로 Agentic Wallet 자체에도 KYT 스크리닝과 지출 가드레일이 내장되어 이중 보안이 적용된다.

---

## 5. 설정 (config.yaml)

```yaml
wallet_agent:
  monitoring:
    balance_check_interval_sec: 30
    low_balance_alert_usdc: 300
  agentic_wallet:
    network: "base"
    cli_timeout_ms: 30000
  transfers:
    max_single_transfer: 1000
    max_daily_transfer: 5000
    auto_fund_enabled: true
    auto_fund_buffer_pct: 0.20
    auto_withdraw_excess_pct: 0.5    # HL 초과분 50% 회수 (NEW)
  security:
    min_reserve_coinbase: 500
    min_reserve_hyperliquid: 200
    max_reserve_hyperliquid: 3000    # HL 최대 보유 한도 (NEW)
    whitelist: []   # 비어있으면 모든 주소 허용 (개발 모드)
```

---

## 6. 환경 변수

Agentic Wallet은 **API 키가 필요 없다**. `awal` CLI 인증만 완료되면 된다.

```bash
# .env에 코인베이스 관련 변수 불필요!
# 대신 최초 1회 인증 필요:
bunx awal auth login your@email.com
bunx awal auth verify <flowId> <code>
```

---

## 7. 스크립트 구조

```
skills/wallet-manager/
├── SKILL.md
└── scripts/
    ├── manage-wallet.ts      # 잔고/리밸런싱/전송 등 종합 관리
    ├── deposit-to-hl.ts      # Arbitrum → HyperLiquid Bridge2 자동 입금
    └── spot-to-perp.ts       # Spot ↔ Perp 내부 전송 (비통합 계정용)

src/services/
├── hyperliquid.service.ts    # HL API (getBalance, getSpotBalance, spotToPerp 등)
└── coinbase.service.ts       # awal CLI 래퍼
```

### package.json 스크립트

```bash
bun run wallet            # 종합 지갑 관리
bun run deposit           # Arbitrum → HL 자동 입금
bun run spot-to-perp      # Spot → Perp 전송 (Unified Account 시 불필요)
```

---

## 관련 문서

- [04-trade-agent.md](./04-trade-agent.md) — trader 스킬 (자금 요청자)
- [06-config-and-deployment.md](./06-config-and-deployment.md) — 전체 설정
- [08-dashboard.md](./08-dashboard.md) — 웹 대시보드 (입금 주소 표시)
