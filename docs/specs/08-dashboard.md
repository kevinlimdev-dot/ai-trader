# 08 - 웹 대시보드 (SvelteKit)

## 1. 개요

AI Trader의 웹 대시보드는 **SvelteKit** (Svelte 5 runes) 기반으로, 봇의 실시간 모니터링, 거래 제어, 지갑 관리를 한 곳에서 수행할 수 있는 관리 인터페이스이다. Bun 런타임 위에서 구동되며, `bun:sqlite`로 트레이딩 DB에 직접 접근한다.

OpenClaw CLI와 연동하여 AI 에이전트의 판단 내용을 실시간으로 표시하고, 자동매매 제어 및 전략 선택을 지원한다.

---

## 2. 기술 스택

| 항목 | 기술 | 비고 |
|------|------|------|
| **프레임워크** | SvelteKit | Svelte 5 runes (`$state`, `$effect`, `$derived`) |
| **스타일링** | Tailwind CSS v4 | 다크 모드 기본, CSS 변수 기반 테마 |
| **차트** | Lightweight Charts | TradingView 오픈소스 차트 라이브러리 |
| **런타임** | Bun | `bun --bun vite dev/build` |
| **DB 접근** | `bun:sqlite` | SSR에서 직접 SQLite 쿼리 |
| **봇 제어** | `Bun.spawn` | 스크립트 실행/중지 |

---

## 3. 디렉토리 구조

```
dashboard/
├── src/
│   ├── lib/
│   │   ├── server/
│   │   │   ├── db.ts              # DB 접근, 설정 관리, 지갑 주소 조회
│   │   │   └── bot.ts             # Bun.spawn으로 봇 스크립트 실행
│   │   ├── components/
│   │   │   ├── Sidebar.svelte     # 사이드바 (내비게이션 + 지갑 주소)
│   │   │   ├── KpiCard.svelte     # KPI 카드 컴포넌트
│   │   │   ├── PriceChart.svelte  # Lightweight Charts 래퍼
│   │   │   ├── TradesTable.svelte # 거래 내역 테이블 (mini 모드 지원)
│   │   │   ├── SignalBadge.svelte # 시그널 방향 배지
│   │   │   └── SetupBanner.svelte # 미설정 경고 배너
│   │   └── types.ts               # TypeScript 타입 정의
│   ├── routes/
│   │   ├── +layout.server.ts      # 레이아웃 데이터 로드
│   │   ├── +layout.svelte         # 공통 레이아웃 (사이드바 + SetupBanner)
│   │   ├── +page.server.ts        # 메인 대시보드 데이터
│   │   ├── +page.svelte           # 메인 대시보드 UI
│   │   ├── positions/             # 포지션 관리 페이지
│   │   ├── trades/                # 거래 내역 페이지
│   │   ├── signals/               # 시그널 분석 페이지
│   │   ├── wallet/                # 지갑 & 입금 안내 페이지
│   │   ├── control/               # 봇 제어 페이지
│   │   └── api/                   # REST API 엔드포인트
│   │       ├── dashboard/+server.ts
│   │       ├── prices/+server.ts       # 실시간 가격
│   │       ├── balances/+server.ts     # 실시간 잔고 (HL + Coinbase)
│   │       ├── snapshots/+server.ts
│   │       ├── signals/+server.ts
│   │       ├── positions/+server.ts
│   │       ├── trades/+server.ts
│   │       ├── coins/+server.ts        # 거래 가능 코인 목록
│   │       ├── wallet/+server.ts
│   │       ├── mode/+server.ts
│   │       ├── setup/+server.ts
│   │       └── bot/
│   │           ├── run/+server.ts      # 개별 스크립트 실행
│   │           ├── runner/+server.ts   # Runner 제어 (start/stop/once)
│   │           ├── openclaw/+server.ts # OpenClaw 에이전트 실행
│   │           ├── strategy/+server.ts # 전략 조회/변경
│   │           ├── monitor/+server.ts  # 포지션 모니터 제어
│   │           ├── deposit/+server.ts  # Arbitrum → HL 입금
│   │           ├── log/+server.ts      # Runner 로그 tail
│   │           └── kill-switch/+server.ts
│   └── app.css                    # 글로벌 스타일 (CSS 변수)
├── scripts/
│   └── awal-sidecar.cjs           # awal CLI 캐시 사이드카 (Node.js)
├── package.json
├── svelte.config.js
├── vite.config.ts
└── tailwind.config.js
```

---

## 4. 페이지 구성

### 4.1 메인 대시보드 (`/`)

트레이딩 봇의 전체 현황을 한눈에 파악할 수 있는 메인 페이지.

**레이아웃 (상단 → 하단):**

| 행 | 좌측 | 우측 | 갱신 주기 |
|----|------|------|----------|
| 1 | KPI 카드 (거래수, 승률, PnL) | Mode + Strategy 토글 | 10초 |
| 2 | Wallet Balances (HL + CB + Total) | 내 입금 지갑 (주소 복사) | 10초 / 60초 |
| 3 | **자동매매 컨트롤** (시작/정지, 1회 실행, 모니터) | **Open Positions (HL 실시간)** | - / 10초 |
| 4 | **AI 분석 판단** (시그널 + 복합점수) | **거래 활동 로그** (Runner 로그) | 10초 |
| 5 | Live Prices (mini) | Recent Trades (mini, 40건) | 3초 / 10초 |
| 6 | 가격 차트 (Lightweight Charts) | — | 60초 |

**주요 변경 (이전 대비):**
- **Open Positions**: 자동매매 컨트롤 옆으로 이동, HyperLiquid 실시간 데이터로 표시
- **거래 활동 로그**: AI 분석 판단 옆으로 이동, 최신 로그가 상단에 표시
- **포지션 모니터 카운트다운**: 1초 단위 실시간 갱신
- **Recent Trades**: 40건으로 확대, 현재 가격·청산 거리·수익 확률 표시

### 4.2 포지션 (`/positions`)

- 현재 열린 포지션 목록
- 진입가, 현재가, PnL, 레버리지
- 개별 포지션 청산 기능

### 4.3 거래 내역 (`/trades`)

- 전체 거래 히스토리 (페이징)
- 날짜별 필터, 심볼별 필터
- 수익/손실 하이라이트

### 4.4 시그널 (`/signals`)

- 최근 분석 시그널 목록
- 각 지표별 상세 (RSI, MACD, 볼린저, MA, 스프레드)
- 복합 점수 시각화

### 4.5 지갑 (`/wallet`)

- Coinbase + HyperLiquid 잔고 현황
- **단일 입금 안내**: Coinbase Agentic Wallet 주소 표시
- 자금 흐름 시각화 (Coinbase → HyperLiquid 자동 배분)
- 최근 자금 이동 이력

### 4.6 봇 제어 (`/control`)

- 개별 스크립트 실행/중지 (collect, analyze, trade, wallet)
- Kill Switch 활성화/해제
- 스크립트 실행 로그

---

## 5. API 엔드포인트

모든 API는 SvelteKit의 `+server.ts` 파일로 구현된다.

### 5.1 데이터 조회

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/dashboard` | 대시보드 KPI 데이터 |
| GET | `/api/prices` | 실시간 가격 (바이낸스/HL + 스프레드) |
| GET | `/api/balances` | 실시간 잔고 (HL + Coinbase + Total) |
| GET | `/api/snapshots` | 차트용 가격 스냅샷 |
| GET | `/api/signals` | 최신 분석 시그널 |
| GET | `/api/positions` | 열린 포지션 목록 |
| GET | `/api/trades` | 거래 내역 (쿼리: limit, offset) |
| GET | `/api/coins` | 거래 가능 코인 목록 (거래량 상위 50) |
| GET | `/api/wallet` | 지갑 주소 (HL + Coinbase) |
| GET | `/api/setup` | 설정 검증 결과 |
| GET | `/api/mode` | 현재 트레이딩 모드 |
| POST | `/api/mode` | 모드 변경 (`{ mode: "paper" \| "live" }`) |

### 5.2 봇 제어

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/api/bot/run` | 개별 스크립트 실행 (`{ script: "collect" }`) |
| GET | `/api/bot/runner` | Runner 상태 조회 (JSON from `/tmp/`) |
| POST | `/api/bot/runner` | Runner 제어 (`{ action: "start" \| "stop" \| "once" }`) |
| GET | `/api/bot/monitor` | 포지션 모니터 상태 조회 |
| POST | `/api/bot/monitor` | 모니터 제어 (`{ action: "start" \| "stop" }`) |
| GET | `/api/bot/strategy` | 현재 전략 조회 |
| POST | `/api/bot/strategy` | 전략 변경 (`{ strategy: "aggressive" }`) |
| POST | `/api/bot/openclaw` | OpenClaw 에이전트 실행 (`{ action: "run" \| "once" }`) |
| POST | `/api/bot/deposit` | Arbitrum → HL 입금 (`{ action: "check" \| "deposit" }`) |
| GET | `/api/bot/log` | Runner 로그 tail (최근 N줄) |
| POST | `/api/bot/kill-switch` | Kill Switch 활성화/해제 |

---

## 6. 서버 사이드 로직

### 6.1 DB 접근 (`lib/server/db.ts`)

SSR에서 `bun:sqlite`로 트레이딩 DB에 직접 접근한다. **writable 모드**로 초기화하여 포지션 동기화 등 실시간 업데이트가 가능하다.

```typescript
import { Database } from "bun:sqlite";
import { resolve } from "path";

const PROJECT_ROOT = resolve(process.cwd(), "..");
const DB_PATH = resolve(PROJECT_ROOT, "data/ai-trader.db");

let dbInstance: Database | null = null;

export function getDb(): Database | null {
  if (!dbInstance) {
    try {
      dbInstance = new Database(DB_PATH); // writable (readonly 제거)
      dbInstance.exec("PRAGMA journal_mode = WAL");
    } catch {
      return null;
    }
  }
  return dbInstance;
}
```

**주요 함수:**
- `getDashboardData(hlPositions?)` — KPI 집계 (거래수, 승률, PnL) + HL 실시간 포지션 연동
- `getLatestSignals()` — 최신 시그널 조회
- `getRecentTrades(limit)` — 최근 거래 내역 (기본 40건, HL 실시간 PnL 보강)
- `getOpenPositions()` — 열린 포지션
- `getHlLivePositions()` — **HyperLiquid 실시간 포지션** (5초 캐시)
- `syncPositionsWithHl(hlPositions)` — **DB ↔ HL 포지션 동기화** (external_close 처리)
- `getLatestPricesWithChange()` — 실시간 가격 + 변동률
- `fetchHlBalance()` — HyperLiquid 잔고 (Unified Account 이중계산 방지)
- `getWalletAddresses()` — 지갑 주소 (HL: `.env`, CB: `awal`)
- `validateSetup()` — 설정 검증 (config.yaml, .env, DB)

### 6.2 HyperLiquid 잔고 계산 (Unified Account)

HyperLiquid **Unified Account**에서는 Spot USDC가 Perps 마진에 자동 포함된다. 이중 계산을 방지하기 위해:

```typescript
async function fetchHlBalance() {
  const perpVal = clearinghouseState.accountValue;  // Perps 계좌 총액
  const spotTotalUsd = spotBalance.usdc;             // Spot USDC 잔고
  // Unified Account: perpVal이 이미 spot 포함 → 큰 쪽만 사용
  // 포지션 있을 때 perpVal < spotTotalUsd일 수 있으므로 합산 방지
  const totalUsd = perpVal >= spotTotalUsd ? perpVal : perpVal + spotTotalUsd;
  return totalUsd;
}
```

> **주의:** 이전 로직(`perpVal > 0 ? perpVal : spotTotalUsd`)은 포지션이 있어 perpVal이 낮을 때 잔고를 과소 표시하는 문제가 있었다. 현재 로직은 perpVal이 spotTotalUsd보다 크면 (Unified로 이미 포함) perpVal만 사용하고, 그렇지 않으면 합산한다.

### 6.3 HyperLiquid 실시간 포지션 동기화

대시보드는 10초마다 HyperLiquid의 실시간 포지션을 가져와 DB와 동기화한다:

```typescript
// 1. HL 실시간 포지션 가져오기 (5초 캐시)
const hlPositions = await getHlLivePositions();

// 2. DB와 동기화
const syncResult = syncPositionsWithHl(hlPositions);
// { synced: 5, closed: 1, updated: 4 }
// - synced: HL에 존재하는 열린 포지션 수
// - closed: DB에만 있던 open 상태를 external_close로 변경
// - updated: 실시간 PnL 업데이트된 포지션 수
```

**동기화 로직:**
- `coin` + `side` (LONG/SHORT)로 매칭
- DB에 `open`이지만 HL에 없는 포지션 → `status: 'closed'`, `exit_reason: 'external_close'`
- HL에 존재하는 매칭 포지션 → `pnl`, `peak_pnl_pct` 실시간 업데이트
- KPI 계산에서 `external_close` 거래는 제외 (거래수, PnL, 승률)

### 6.3 awal-sidecar.cjs

`awal` CLI 호출 결과를 캐시하는 Node.js 사이드카 프로세스. 대시보드와 `/tmp/ai-trader-awal-cache.json` 파일로 통신한다.

- Coinbase 인증 상태, 잔고, 주소를 주기적으로 캐시
- PID별 임시 파일 사용 (ENOENT 방지)
- 에러 로깅 스로틀링 적용

---

## 7. 실시간 데이터 (폴링 전략)

Svelte 5의 `$effect`를 사용한 **계층적 폴링**으로 API 쿼터를 절약하면서 실시간성을 보장한다.

### 7.1 폴링 계층

| 계층 | 데이터 | 주기 | API 엔드포인트 |
|------|--------|------|----------------|
| **Tier 1** (빠름) | 실시간 가격 | 3초 | `/api/prices` |
| **Tier 2** (보통) | 대시보드, 시그널, 잔고, 거래, 로그 | 10초 | `/api/dashboard`, `/api/balances` 등 |
| **Tier 3** (느림) | 차트, 지갑 주소, OpenClaw 상태 | 30~60초 | `/api/snapshots`, `/api/bot/openclaw` |

---

## 8. 설정 검증 (Setup Banner)

대시보드 상단에 **SetupBanner** 컴포넌트가 미설정 항목을 지속적으로 표시한다.

### 8.1 검증 항목

| 검증 | 조건 | 레벨 |
|------|------|------|
| `config.yaml` 존재 | 파일 없음 | **Error** |
| `.env` 존재 | 파일 없음 | **Error** |
| `HYPERLIQUID_PRIVATE_KEY` | 값이 비어있거나 기본값 | **Error** |
| `HYPERLIQUID_DEPOSIT_ADDRESS` | 값이 비어있거나 기본값 | **Warning** |
| DB 존재 | `data/ai-trader.db` 없음 | **Warning** |
| Agentic Wallet 인증 | `bunx awal status` 실패 | **Warning** |

### 8.2 표시 방식

- **Error**: 빨간색 배너, 거래 실행 차단
- **Warning**: 노란색 배너, 거래는 가능하지만 일부 기능 제한
- 설정 완료 시 자동으로 배너 숨김

---

## 9. Paper/Live 모드 전환

### 9.1 UI

메인 대시보드 상단에 토글 스위치로 표시.

| 모드 | UI | 동작 |
|------|-----|------|
| Paper | 녹색 배지 "PAPER" | 가상 거래, 안전 |
| Live | 빨간색 배지 "LIVE" + 확인 다이얼로그 | 실제 거래, 주의 |

### 9.2 전환 흐름

```
토글 클릭 → (Live 전환 시) 확인 다이얼로그 표시
  → POST /api/mode { mode: "live" }
  → 서버: config.yaml 파일의 general.mode 업데이트
  → 응답: { success: true, mode: "live" }
  → UI 즉시 반영
```

---

## 10. 전략 선택

### 10.1 3종 프리셋

| 전략 | 특징 | 진입 임계 | 레버리지 | 리스크 |
|------|------|----------|---------|--------|
| Conservative | 안전, 신호확실시만 진입 | 0.5 | 5x | 2% |
| Balanced | 균형, 기본 설정 | 0.3 | 7x | 3% |
| **Aggressive** | 공격적, 빈번한 진입 | 0.15 | 10x | 5% |

### 10.2 UI

메인 대시보드에 3개 버튼으로 표시. 선택된 전략은 요약 카드로 핵심 파라미터(진입 임계값, 레버리지, SL/TP, 최대 포지션)를 표시한다.

```
POST /api/bot/strategy { strategy: "aggressive" }
→ 서버: config.yaml 파일의 general.strategy 업데이트
→ 다음 분석/거래부터 적용
```

---

## 11. 파이프라인 실행

### 11.1 7단계 파이프라인 + 독립 모니터

```
1. 가격 수집         (collect-prices.ts)
2. 기술적 분석       (analyze.ts) — 전략 프리셋 적용
3. 시장 심리 수집    (collect-sentiment.ts) — 실패해도 계속
4. AI 자율 판단      (summarize.ts → apply-decision.ts) — OpenClaw AI
5. 자금 리밸런싱     (manage-wallet.ts --action auto-rebalance) — 실패해도 계속
6. 거래 실행         (execute-trade.ts) — AI 승인 시그널만 실행
7. 결과 보고         — AI 판단 근거 포함

→ 거래 완료 후 position-monitor.ts 자동 시작 (독립 프로세스)
```

### 11.2 실행 모드

| 모드 | 경로 | 설명 |
|------|------|------|
| **자동매매 시작** | POST `/api/bot/runner` `{ action: "start" }` | 5분 주기 연속 실행, OpenClaw 사용 (가능 시) |
| **1회 실행** | POST `/api/bot/runner` `{ action: "once" }` | 파이프라인 1회 실행 후 종료, 모니터는 백그라운드 유지 |
| **자동매매 정지** | POST `/api/bot/runner` `{ action: "stop" }` | Runner 중지 |

### 11.3 OpenClaw 연동

OpenClaw 데몬이 활성 상태면 Runner가 OpenClaw 에이전트를 통해 파이프라인을 실행한다:
- 대시보드에 **OpenClaw 연결 상태** 표시 (Connected / Not Connected)
- OpenClaw 미연결 시 **직접 실행 모드**로 자동 fallback
- OpenClaw 에이전트의 실시간 출력이 대시보드에 스트리밍

### 11.4 AI 분석 판단 표시

대시보드에 OpenClaw/Claude 봇의 분석 판단을 실시간으로 표시:
- 각 지표별 개별 점수 (Spread, RSI, MACD, Bollinger, MA)
- 복합 점수 및 거래 결정 (LONG / SHORT / HOLD)
- 신뢰도 및 목표가/손절가
- 확장 가능한 상세 보기 (각 심볼별)

---

## 12. 포지션 모니터 제어

### 12.1 독립 프로세스

`src/position-monitor.ts`는 Runner와 별개로 동작하는 독립 프로세스이다.

| 항목 | 설정 |
|------|------|
| 체크 주기 | 15초 |
| 자동 시작 | Runner가 거래 실행 후 자동 시작 |
| 자동 종료 | 포지션 없으면 20 idle cycles (~5분) 후 종료 |
| 상태 파일 | `/tmp/ai-trader-monitor-status.json` |
| 제어 파일 | `/tmp/ai-trader-monitor-control.json` |

### 12.2 UI

메인 대시보드에 모니터 상태 표시:
- 상태 (Running / Stopped)
- 현재 추적 중인 포지션 수
- 마지막 체크 시간
- 시작/정지 버튼

---

## 13. Arbitrum → HyperLiquid 입금

### 13.1 원클릭 입금

대시보드에서 Arbitrum USDC를 HyperLiquid로 원클릭 입금:

```
[입금 버튼 클릭]
  → POST /api/bot/deposit { action: "check" }
  → 서버: Arbitrum USDC 잔고 확인 (dry-run)
  → UI: 잔고 표시 + 확인 요청
  → POST /api/bot/deposit { action: "deposit" }
  → 서버: deposit-to-hl.ts 실행 (ERC20 transfer → Bridge2)
  → ~1분 후 HyperLiquid Spot 입금 완료
```

### 13.2 주소 표시

- **HyperLiquid**: `.env`의 `HYPERLIQUID_DEPOSIT_ADDRESS` (Arbitrum)
- **Coinbase**: `awal-sidecar.cjs` 캐시에서 조회 (Base)
- 두 주소 모두 메인 대시보드에 항상 표시, 복사 버튼 포함

---

## 14. 거래 내역 테이블 (TradesTable)

### 14.1 mini 모드

`TradesTable.svelte`는 `mini` prop으로 컴팩트 모드를 지원:

| 항목 | 기본 | mini |
|------|------|------|
| 폰트 | text-sm | text-[10px] |
| Side 표시 | Long / Short | L / S |
| Status 표시 | 배지 | 색상 점 |
| 스크롤 | overflow-y-auto | 없음 (전체 표시) |
| 기본 행 수 | 10 | 20 |

### 14.2 레이아웃

Live Prices와 Recent Trades가 `grid grid-cols-1 lg:grid-cols-2`로 나란히 배치된다. 두 섹션 모두 컴팩트 미니 스타일이 적용되어 정보 밀도가 높다.

---

## 15. 실행 방법

```bash
# 의존성 설치
cd dashboard && bun install

# 개발 모드
bun run dev
# → http://localhost:5173

# 빌드
bun run build

# 프리뷰
bun run preview

# 프로젝트 루트에서 실행
cd .. && bun run dashboard
```

### Vite + Bun 설정

`bun:sqlite`는 Bun 전용이므로 Vite 설정에서 SSR 외부화 처리가 필요하다.

```typescript
// vite.config.ts
export default defineConfig({
  plugins: [sveltekit()],
  ssr: {
    external: ["bun:sqlite"],
  },
});
```

`package.json`의 스크립트는 Bun 런타임을 강제한다:

```json
{
  "scripts": {
    "dev": "bun --bun vite dev",
    "build": "bun --bun vite build",
    "preview": "bun --bun vite preview"
  }
}
```

---

## 관련 문서

- [01-overview.md](./01-overview.md) — 프로젝트 개요
- [02-data-agent.md](./02-data-agent.md) — 데이터 수집 (Rate Limiter)
- [05-wallet-agent.md](./05-wallet-agent.md) — 지갑 관리 (auto-rebalance, deposit)
- [06-config-and-deployment.md](./06-config-and-deployment.md) — 설정 및 배포
- [07-data-flow.md](./07-data-flow.md) — 데이터 흐름
- [09-strategy.md](./09-strategy.md) — 투자 전략 시스템
- [10-ai-decision.md](./10-ai-decision.md) — AI 자율 투자 판단 시스템
