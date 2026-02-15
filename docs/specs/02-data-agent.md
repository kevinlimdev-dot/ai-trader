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

## 관련 문서

- [01-overview.md](./01-overview.md) — 프로젝트 개요
- [03-analysis-agent.md](./03-analysis-agent.md) — analyzer 스킬 (데이터 소비자)
- [06-config-and-deployment.md](./06-config-and-deployment.md) — config.yaml 전체 구조
