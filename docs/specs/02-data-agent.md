# 02 - data-collector 스킬 (데이터 수집)

## 1. 개요

`data-collector` 스킬은 바이낸스 선물과 하이퍼리퀴드에서 실시간 가격 데이터를 수집하고, 표준화된 스냅샷으로 가공하여 저장한다. OpenClaw 에이전트가 이 스킬의 `SKILL.md` 지침에 따라 `exec` 도구로 TypeScript 스크립트를 실행하는 방식으로 동작한다.

---

## 2. SKILL.md

```markdown
---
name: data-collector
description: 바이낸스 선물과 하이퍼리퀴드에서 실시간 가격 데이터를 수집하고 표준화된 스냅샷을 생성합니다.
metadata: {"openclaw":{"requires":{"bins":["bun"]},"primaryEnv":"BINANCE_API_KEY"}}
---

## 목적

두 거래소(바이낸스 선물, 하이퍼리퀴드)의 실시간 가격을 수집하여
`data/snapshots/latest.json`에 표준화된 스냅샷을 저장합니다.

## 사용 시나리오

- 사용자가 "가격 수집해", "현재 가격 확인해" 등 요청 시
- cron 작업에서 트레이딩 루프의 첫 번째 단계로 호출 시
- analyzer 스킬 실행 전 데이터 갱신이 필요할 때

## 실행 방법

`exec` 도구로 아래 명령을 실행하세요:

```
bun run {baseDir}/scripts/collect-prices.ts
```

선택적으로 특정 심볼만 수집:

```
bun run {baseDir}/scripts/collect-prices.ts --symbol BTC
```

## 출력

- `data/snapshots/latest.json` — 최신 가격 스냅샷 (JSON)
- SQLite DB `data/ai-trader.db`의 `snapshots` 테이블에 이력 저장

## 출력 데이터 형태

```json
{
  "timestamp": "2026-02-14T12:00:00.123Z",
  "symbol": "BTC",
  "binance": { "mark_price": 65432.10, "bid": 65430.00, "ask": 65434.20, "volume_24h": 125000.50, "funding_rate": 0.0001 },
  "hyperliquid": { "mid_price": 65420.50, "bid": 65418.00, "ask": 65423.00 },
  "spread": { "absolute": 11.60, "percentage": 0.0177, "direction": "binance_higher" }
}
```

## 에러 시

- API 타임아웃: 자동 재시도 3회
- 양쪽 모두 데이터 없음: `{ "status": "no_data" }` 반환
- 이상치 감지(±10% 급변): 경고 로그와 함께 `anomaly: true` 플래그 추가

## 설정

트레이딩 설정은 프로젝트 루트 `config.yaml`의 `data_agent` 섹션 참조.
```

---

## 3. 데이터 소스

### 3.1 바이낸스 선물

**구현**: REST API 직접 호출 (경량 구현 — 가격 조회에 API 키 불필요)

```typescript
// src/services/binance.service.ts
// exponential backoff 재시도 (3회) + AbortController 타임아웃 내장

const binance = new BinanceService();

// Mark Price + Funding Rate
const priceData = await binance.getMarkPrice("BTCUSDT");
// { markPrice: 65432.1, fundingRate: 0.0001 }

// 오더북 (best bid/ask)
const depth = await binance.getDepth("BTCUSDT", 5);

// 1분봉 캔들
const candles = await binance.getKlines("BTCUSDT", "1m", 100);

// 전체 데이터 (병렬 호출)
const fullData = await binance.getFullData("BTCUSDT");
```

### 3.2 하이퍼리퀴드

**SDK**: `@nktkas/hyperliquid` (`InfoClient` / `ExchangeClient`)

```typescript
// src/services/hyperliquid.service.ts
import { HttpTransport, InfoClient } from "@nktkas/hyperliquid";

const transport = new HttpTransport({ apiUrl: "https://api.hyperliquid.xyz" });
const infoClient = new InfoClient({ transport });

// 현재 가격 (전체)
const allMids = await infoClient.allMids();
// { "BTC": "65432.1", "ETH": "3456.7", ... }

// 오더북
const l2 = await infoClient.l2Book({ coin: "BTC" });
```

---

## 4. PriceSnapshot 타입

```typescript
// src/models/price-snapshot.ts
export interface PriceSnapshot {
  timestamp: string;
  symbol: string;
  binance: {
    mark_price: number;
    bid: number;
    ask: number;
    volume_24h: number;
    funding_rate: number;
  };
  hyperliquid: {
    mid_price: number;
    bid: number;
    ask: number;
  };
  spread: {
    absolute: number;
    percentage: number;
    direction: "binance_higher" | "binance_lower";
  };
  candles_1m?: {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  };
}
```

---

## 5. 설정 (config.yaml)

```yaml
data_agent:
  symbols:
    - symbol: "BTC"
      binance_pair: "BTCUSDT"
      hyperliquid_pair: "BTC"
    - symbol: "ETH"
      binance_pair: "ETHUSDT"
      hyperliquid_pair: "ETH"

  polling_interval_ms: 1000
  candle_interval: "1m"
  candle_lookback: 100

  binance:
    reconnect_delay_ms: 5000
    max_reconnect_attempts: 10

  hyperliquid:
    base_url: "https://api.hyperliquid.xyz"
    request_timeout_ms: 5000

  storage:
    max_snapshots_per_symbol: 3600
    cleanup_interval_min: 30
```

---

## 6. 스크립트 구조

```
skills/data-collector/
├── SKILL.md
└── scripts/
    └── collect-prices.ts     # 메인 스크립트 (bun run)

src/services/
├── binance.service.ts        # 바이낸스 API 래퍼
└── hyperliquid.service.ts    # 하이퍼리퀴드 API 래퍼

src/models/
└── price-snapshot.ts         # 타입 정의
```

---

## 7. Rate Limiter (거래소 API 쿼터 관리)

거래소 API의 요청 한도를 초과하지 않도록 **Token Bucket** 방식의 Rate Limiter를 적용한다. `src/utils/rate-limiter.ts`에 구현되어 있으며, 각 서비스에서 싱글턴 인스턴스를 사용한다.

### 7.1 바이낸스 선물 API 제한

| 항목 | 값 |
|------|-----|
| IP당 한도 | 2,400 req/min (40 req/s) |
| 적용 안전 마진 | 70% → **28 req/s** (1,680/min) |
| 버스트 허용량 | 60 토큰 |
| Weight 기반 | 대부분 1, klines=5, depth=5~50 |

### 7.2 하이퍼리퀴드 API 제한

| 항목 | 값 |
|------|-----|
| 공식 한도 | 1,200 req/min (20 req/s) |
| 적용 안전 마진 | 70% → **14 req/s** (840/min) |
| 버스트 허용량 | 30 토큰 |

### 7.3 API Weight 매핑

```typescript
// 바이낸스
const BINANCE_WEIGHTS = {
  "/fapi/v1/premiumIndex": 1,
  "/fapi/v1/depth": 5,
  "/fapi/v1/ticker/24hr": 1,
  "/fapi/v1/klines": 5,
};

// 하이퍼리퀴드
const HYPERLIQUID_WEIGHTS = {
  allMids: 1,
  l2Book: 1,
  meta: 1,
  clearinghouseState: 1,
  order: 2,
};
```

### 7.4 서비스 연동

각 서비스 (`binance.service.ts`, `hyperliquid.service.ts`)에서 API 호출 전 `await limiter.acquire(weight)` 로 토큰을 소비한다. 토큰이 부족하면 자동으로 대기 후 재시도한다.

```typescript
// binance.service.ts 예시
import { getBinanceRateLimiter, BINANCE_WEIGHTS } from "../utils/rate-limiter";

const limiter = getBinanceRateLimiter();
await limiter.acquire(BINANCE_WEIGHTS["/fapi/v1/klines"]); // weight 5
const data = await fetch(url);
```

### 7.5 429 응답 처리

바이낸스에서 429 (Rate Limit Exceeded) 응답 시 `Retry-After` 헤더를 존중하여 대기한 뒤 재시도한다.

---

## 8. 실시간 가격 데이터 (대시보드 연동)

대시보드에서 실시간 가격을 표시하기 위해 DB의 최신 스냅샷을 조회하는 API가 제공된다.

### 8.1 API 엔드포인트

```
GET /api/live-prices
```

### 8.2 응답 형태

```json
[
  {
    "symbol": "BTC",
    "binance_price": 65432.10,
    "hl_price": 65420.50,
    "spread_pct": 0.0177,
    "timestamp": "2026-02-14T12:00:00.123Z",
    "binance_change_pct": 1.23,
    "hl_change_pct": 1.15
  }
]
```

### 8.3 대시보드 갱신 주기

| 데이터 | 주기 | 비고 |
|--------|------|------|
| 실시간 가격 | 3초 | 대시보드 메인 Live Prices 패널 |
| 시그널/대시보드 | 10초 | KPI, 거래 내역, 포지션 |
| 차트 | 60초 | Lightweight Charts 업데이트 |

이 계층적 폴링은 API 쿼터를 절약하면서도 핵심 데이터의 실시간성을 보장한다.

---

## 관련 문서

- [01-overview.md](./01-overview.md) — 프로젝트 개요
- [03-analysis-agent.md](./03-analysis-agent.md) — analyzer 스킬 (데이터 소비자)
- [06-config-and-deployment.md](./06-config-and-deployment.md) — config.yaml 전체 구조
- [08-dashboard.md](./08-dashboard.md) — 웹 대시보드 상세 스펙
