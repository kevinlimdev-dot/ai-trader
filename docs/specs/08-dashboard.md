# 08 - 웹 대시보드 (SvelteKit)

## 1. 개요

AI Trader의 웹 대시보드는 **SvelteKit** (Svelte 5 runes) 기반으로, 봇의 실시간 모니터링, 거래 제어, 지갑 관리를 한 곳에서 수행할 수 있는 관리 인터페이스이다. Bun 런타임 위에서 구동되며, `bun:sqlite`로 트레이딩 DB에 직접 접근한다.

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
│   │   │   ├── TradesTable.svelte # 거래 내역 테이블
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
│   │       ├── live-prices/+server.ts
│   │       ├── snapshots/+server.ts
│   │       ├── signals/+server.ts
│   │       ├── positions/+server.ts
│   │       ├── trades/+server.ts
│   │       ├── wallet-addresses/+server.ts
│   │       ├── mode/+server.ts
│   │       ├── bot/run/+server.ts
│   │       ├── bot/pipeline/+server.ts
│   │       └── setup/+server.ts
│   └── app.css                    # 글로벌 스타일 (CSS 변수)
├── package.json
├── svelte.config.js
├── vite.config.ts
└── tailwind.config.js
```

---

## 4. 페이지 구성

### 4.1 메인 대시보드 (`/`)

트레이딩 봇의 전체 현황을 한눈에 파악할 수 있는 메인 페이지.

| 섹션 | 내용 | 갱신 주기 |
|------|------|----------|
| **KPI 카드** | 총 거래수, 승률, 총 PnL, 최대 이익/손실 | 10초 |
| **Live Prices** | 바이낸스/HL 실시간 가격, 변동률, 스프레드 | 3초 |
| **Wallet Balances** | Coinbase, HyperLiquid, 총 잔고 | 10초 |
| **내 입금 지갑** | HyperLiquid + Coinbase 주소 (복사 버튼) | 60초 |
| **Paper/Live 토글** | 트레이딩 모드 전환 | 즉시 |
| **Run All 버튼** | 5단계 파이프라인 순차 실행 | - |
| **가격 차트** | Lightweight Charts (바이낸스/HL 오버레이) | 60초 |
| **최근 시그널** | 최신 분석 결과 (방향, 신뢰도, 지표) | 10초 |
| **최근 거래** | 최근 5건 거래 내역 | 10초 |

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

- 개별 스크립트 실행/중지 (collect, analyze, trade, monitor, wallet)
- Kill Switch 활성화/해제
- 스크립트 실행 로그

---

## 5. API 엔드포인트

모든 API는 SvelteKit의 `+server.ts` 파일로 구현된다.

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/dashboard` | 대시보드 KPI 데이터 |
| GET | `/api/live-prices` | 실시간 가격 (바이낸스/HL + 변동률) |
| GET | `/api/snapshots` | 차트용 가격 스냅샷 |
| GET | `/api/signals` | 최신 분석 시그널 |
| GET | `/api/positions` | 열린 포지션 목록 |
| GET | `/api/trades` | 거래 내역 (쿼리 파라미터: limit, offset) |
| GET | `/api/wallet-addresses` | 지갑 주소 (HL + Coinbase) |
| GET | `/api/setup` | 설정 검증 결과 |
| GET | `/api/mode` | 현재 트레이딩 모드 |
| POST | `/api/mode` | 모드 변경 (`{ mode: "paper" | "live" }`) |
| POST | `/api/bot/run` | 개별 스크립트 실행 (`{ script: "collect" }`) |
| POST | `/api/bot/pipeline` | 전체 파이프라인 실행 (Run All) |

---

## 6. 서버 사이드 로직

### 6.1 DB 접근 (`lib/server/db.ts`)

SSR에서 `bun:sqlite`로 트레이딩 DB에 직접 접근한다.

```typescript
import { Database } from "bun:sqlite";
import { resolve } from "path";

const PROJECT_ROOT = resolve(process.cwd(), "..");
const DB_PATH = resolve(PROJECT_ROOT, "data/ai-trader.db");

let dbInstance: Database | null = null;

export function getDb(): Database | null {
  if (!dbInstance) {
    try {
      dbInstance = new Database(DB_PATH, { readonly: true });
      dbInstance.exec("PRAGMA journal_mode = WAL");
    } catch {
      return null;
    }
  }
  return dbInstance;
}
```

**주요 함수:**
- `getDashboardData()` — KPI 집계 (거래수, 승률, PnL)
- `getLatestSignals()` — 최신 시그널 조회
- `getRecentTrades(limit)` — 최근 거래 내역
- `getOpenPositions()` — 열린 포지션
- `getLatestPricesWithChange()` — 실시간 가격 + 변동률
- `getWalletAddresses()` — 지갑 주소 (HL: `.env`, CB: `awal`)
- `validateSetup()` — 설정 검증 (config.yaml, .env, DB)

### 6.2 지갑 주소 조회

```typescript
// Coinbase Agentic Wallet 주소 자동 조회 (5분 캐시)
async function fetchCoinbaseAddress(): Promise<string | null> {
  const proc = Bun.spawn(["bunx", "awal", "address", "--json"], {
    stdout: "pipe", stderr: "pipe",
  });
  // ... 파싱 및 캐시 로직
}

// HyperLiquid 주소는 .env의 HYPERLIQUID_DEPOSIT_ADDRESS에서 읽음
```

### 6.3 봇 스크립트 실행 (`lib/server/bot.ts`)

```typescript
type ScriptName = "collect" | "analyze" | "trade" | "monitor"
                | "auto-rebalance" | "wallet-balance";

export async function runScript(name: ScriptName): Promise<RunResult> {
  const proc = Bun.spawn(getScriptCommand(name), {
    stdout: "pipe", stderr: "pipe",
    cwd: PROJECT_ROOT,
  });
  // timeout, exit code, stdout/stderr 처리
}

export async function runPipeline(): Promise<PipelineResult> {
  const steps = ["collect", "analyze", "auto-rebalance", "trade", "monitor"];
  // 순차 실행, auto-rebalance 실패 시에도 계속 진행
}
```

---

## 7. 실시간 데이터 (폴링 전략)

Svelte 5의 `$effect`를 사용한 **계층적 폴링**으로 API 쿼터를 절약하면서 실시간성을 보장한다.

### 7.1 폴링 계층

| 계층 | 데이터 | 주기 | API 엔드포인트 |
|------|--------|------|----------------|
| **Tier 1** (빠름) | 실시간 가격 | 3초 | `/api/live-prices` |
| **Tier 2** (보통) | 대시보드, 시그널, 포지션 | 10초 | `/api/dashboard`, `/api/signals` |
| **Tier 3** (느림) | 차트, 지갑 주소 | 60초 | `/api/snapshots`, `/api/wallet-addresses` |

### 7.2 구현 패턴

```svelte
<script>
  let livePrices = $state(data.livePrices);
  let dashboardData = $state(data.dashboard);

  $effect(() => {
    // Tier 1: 3초마다 실시간 가격
    const t1 = setInterval(async () => {
      const res = await fetch("/api/live-prices");
      livePrices = await res.json();
    }, 3_000);

    // Tier 2: 10초마다 대시보드
    const t2 = setInterval(async () => {
      const res = await fetch("/api/dashboard");
      dashboardData = await res.json();
    }, 10_000);

    return () => {
      clearInterval(t1);
      clearInterval(t2);
    };
  });
</script>
```

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

## 10. 파이프라인 실행 (Run All)

### 10.1 5단계 파이프라인

```
1. 가격 수집      (collect-prices.ts)
2. 시그널 분석    (analyze.ts)
3. 자금 리밸런싱  (manage-wallet.ts --action auto-rebalance)
4. 거래 실행      (execute-trade.ts)
5. 포지션 모니터링 (execute-trade.ts --action monitor)
```

### 10.2 UI 진행 표시

각 단계별로 상태 아이콘이 실시간 변경:
- ⏳ 대기 중
- 🔄 실행 중 (스피너)
- ✅ 성공
- ❌ 실패

`auto-rebalance`(3단계)가 실패하더라도 4, 5단계는 계속 진행된다.

---

## 11. 입금 지갑 주소 표시

사용자가 자금을 입금해야 하는 지갑 주소를 **항상 보이도록** 3곳에 표시한다.

### 11.1 사이드바

- **"내 지갑"** 섹션에 HyperLiquid + Coinbase 주소 축약 표시
- 클릭 시 전체 주소 복사

### 11.2 메인 대시보드

- **"내 입금 지갑"** 카드에 전체 주소 표시
- 각 주소별 네트워크 표시 (Arbitrum / Base)
- 복사 버튼 포함

### 11.3 지갑 페이지 (`/wallet`)

- 상세 입금 안내 + 자금 흐름 다이어그램
- Coinbase에 입금 → 봇이 자동 배분하는 프로세스 설명

---

## 12. 실행 방법

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
- [05-wallet-agent.md](./05-wallet-agent.md) — 지갑 관리 (auto-rebalance)
- [06-config-and-deployment.md](./06-config-and-deployment.md) — 설정 및 배포
- [07-data-flow.md](./07-data-flow.md) — 데이터 흐름
