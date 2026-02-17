# 10 - AI 자율 투자 판단 시스템 (ai-decision)

## 1. 개요

`ai-decision` 스킬은 기술적 분석(analyzer)과 시장 심리 데이터를 결합하여 **OpenClaw AI 에이전트가 자율적으로 투자 결정**을 내리도록 지원한다. 트레이딩 파이프라인의 3~4단계에 해당하며, analyzer가 생성한 시그널을 AI가 검토·필터링한 후 trader에게 전달한다.

### 핵심 원칙

1. **합류(Confluence) 기반 판단** — 단일 지표가 아닌, 기술적 분석과 시장 심리 데이터의 일치 여부로 판단
2. **역발상(Contrarian)** — 군중이 한 방향에 치우쳐 있으면 반대 진입 검토
3. **스마트 머니 추종** — 탑 트레이더(상위 20%) 방향에 가중치
4. **펀딩비 활용** — 극단적 펀딩비에서 반대 포지션으로 펀딩비 수취
5. **OI 분석** — 오픈인터레스트 변화로 스퀴즈 가능성 판단

---

## 2. 스크립트 구성

```
skills/ai-decision/
└── scripts/
    ├── collect-sentiment.ts     # 3단계: 시장 심리 데이터 수집
    ├── summarize.ts             # 4단계: AI 판단용 종합 요약
    └── apply-decision.ts        # 4단계: AI 결정을 시그널에 적용
```

---

## 3. collect-sentiment.ts (시장 심리 수집)

### 3.1 데이터 소스

| 소스 | 데이터 | API | Rate Limit |
|------|--------|-----|-----------|
| **Binance** | 오픈인터레스트(OI) | `/fapi/v1/openInterest` | Weight 1 |
| **Binance** | 펀딩비 히스토리 | `/fapi/v1/fundingRate` | Weight 1 |
| **Binance** | 글로벌 롱/숏 비율 | `/futures/data/globalLongShortAccountRatio` | Weight 1 |
| **Binance** | 탑 트레이더 롱/숏 | `/futures/data/topLongShortPositionRatio` | Weight 1 |
| **Binance** | 테이커 매수/매도 | `/futures/data/takerBuySellVol` | Weight 1 |
| **HyperLiquid** | 펀딩비, OI, 프리미엄, 거래량 | `metaAndAssetCtxs` | 단일 호출 |

### 3.2 수집 범위

- **Binance**: 거래량 상위 20개 코인 (Rate Limit 고려, 5 API × 20 = 100 calls)
- **HyperLiquid**: 전체 자산 (`metaAndAssetCtxs` 단일 API 호출)

### 3.3 심리 분류 (deriveSentiment)

수집된 원시 데이터에서 자동으로 심리 카테고리를 도출한다:

| 필드 | 분류 기준 | 값 예시 |
|------|----------|---------|
| `funding_direction` | 펀딩비 부호/크기 | `bullish_expensive`, `bearish_cheap`, `neutral` |
| `oi_level` | OI 대비 거래량 | `very_high`, `high`, `moderate`, `low` |
| `crowd_bias` | 롱/숏 비율 | `extreme_long`, `long_heavy`, `neutral`, `short_heavy`, `extreme_short` |
| `smart_money_bias` | 탑 트레이더 비율 | `strong_long`, `long`, `neutral`, `short`, `strong_short` |
| `taker_pressure` | 테이커 매수/매도 | `buy_dominant`, `balanced`, `sell_dominant` |
| `overall` | 종합 | `bullish`, `bearish`, `mixed`, `neutral` |

### 3.4 출력

```bash
bun run skills/ai-decision/scripts/collect-sentiment.ts
```

- **파일**: `data/sentiment/latest.json`
- **stdout**: 시장 요약 (bullish/bearish/neutral 코인 수, 전체 분위기)
- **비필수**: 실패해도 파이프라인 계속 진행 (critical: false)

---

## 4. summarize.ts (AI 판단용 종합 요약)

### 4.1 입력 데이터

| 데이터 | 소스 파일 |
|--------|----------|
| 기술적 분석 시그널 | `data/signals/latest.json` |
| 시장 심리 데이터 | `data/sentiment/latest.json` |
| 현재 열린 포지션 | HyperLiquid API 실시간 조회 |
| 계좌 잔고 | HyperLiquid API 실시간 조회 |

### 4.2 출력 형식

AI 에이전트가 소비할 수 있는 구조화된 JSON을 stdout에 출력:

```json
{
  "_instruction": "너는 자율적인 AI 투자 판단자야...",
  "market_overview": {
    "bullish_count": 15,
    "bearish_count": 12,
    "neutral_count": 23,
    "overall_mood": "mixed"
  },
  "account": {
    "balance_usdc": 939.18,
    "open_positions": 5,
    "max_positions": 15,
    "available_slots": 10
  },
  "candidates": [
    {
      "symbol": "BTC",
      "action": "LONG",
      "composite_score": 0.42,
      "confidence": 0.65,
      "entry_price": 67849.9,
      "stop_loss": 67200.0,
      "take_profit": 68800.0,
      "analysis": {
        "spread": { "value_pct": 0.018, "signal": "LONG_BIAS" },
        "rsi": { "value": 35, "signal": "NEUTRAL" },
        "macd": { "histogram": 15.2, "signal": "LONG" },
        "bollinger": { "position": "lower", "signal": "LONG" },
        "ma": { "signal": "STRONG_LONG" }
      },
      "market_sentiment": {
        "funding_rate": 0.0001,
        "open_interest": 85000,
        "premium": 0.002,
        "day_volume_usd": 500000000,
        "crowd_bias": "long_heavy",
        "smart_money": "strong_long",
        "taker_pressure": "sell_dominant",
        "overall_sentiment": "mixed",
        "long_short_ratio": 1.23,
        "top_trader_ratio": 1.45
      }
    }
  ]
}
```

### 4.3 AI 판단 지침 (`_instruction`)

summarize.ts의 `_instruction` 필드에 AI가 판단할 때 고려할 요소를 명시:

1. **기술적 분석**: composite_score, 개별 지표 방향 일치, RSI 극단치, MACD 크로스
2. **시장 심리 (contrarian + momentum)**:
   - `crowd_bias`: 군중이 한 방향이면 역발상 (`extreme_long` → 숏 검토)
   - `smart_money`: 탑 트레이더 방향 추종
   - `taker_pressure`: 단기 모멘텀
   - `funding_rate`: 극단치 시 반대 포지션 (펀딩비 수취)
   - `open_interest`: OI 급증 + 가격 역행 = 스퀴즈 가능성
3. **리스크 관리**: 동일 코인 중복 진입 방지, 최대 포지션 수 준수, R:R 비율

---

## 5. apply-decision.ts (AI 결정 적용)

### 5.1 실행 방법

```bash
bun run skills/ai-decision/scripts/apply-decision.ts --decisions '<JSON 배열>'
```

### 5.2 decisions 형식

```json
[
  {
    "symbol": "BTC",
    "action": "LONG",
    "confidence": 0.7,
    "reason": "RSI 30 반등 + 스마트머니 롱 + 군중 숏(역발상) + 펀딩비 음수(수취 유리)"
  },
  {
    "symbol": "ETH",
    "action": "HOLD",
    "reason": "기술적으로 롱이나 군중과 스마트머니 모두 롱 편향 → 과열 위험"
  }
]
```

### 5.3 처리 로직

1. `data/signals/latest.json` 읽기
2. 각 시그널에 대해 AI 결정 매칭:
   - **매칭 있음**:
     - AI가 `HOLD` → 시그널 `action`을 `HOLD`로 변경
     - AI가 `LONG`/`SHORT` → confidence 업데이트
     - `ai_reviewed: true`, `ai_review_at`, `ai_reason`, `ai_summary` 추가
   - **매칭 없음**: 원래 시그널 유지 (AI 미검토)
3. 수정된 시그널을 `data/signals/latest.json`에 다시 저장

### 5.4 AI 메타데이터 추가

적용 후 각 시그널에 추가되는 필드:

```typescript
{
  ai_reviewed: true,          // AI 검토 완료 여부
  ai_review_at: string,       // 검토 시각 (ISO 8601)
  ai_reason: string,          // AI 판단 근거 (기술적 + 심리적)
  ai_summary: string,         // AI 종합 요약
}
```

---

## 6. 파이프라인 내 위치

```
[7단계 파이프라인]

1. 가격 수집      ← data-collector
2. 기술적 분석    ← analyzer
3. 시장 심리 수집 ← ai-decision/collect-sentiment.ts    ★ HERE
4. AI 자율 판단   ← ai-decision/summarize.ts + apply   ★ HERE
5. 자금 리밸런싱  ← wallet-manager
6. 거래 실행      ← trader (AI 승인 시그널만)
7. 결과 보고
```

### OpenClaw 모드 vs 직접 실행 모드

| 기능 | OpenClaw 모드 | 직접 실행 모드 |
|------|-------------|--------------|
| collect-sentiment.ts | 실행 | 실행 |
| summarize.ts | 실행 → AI 분석 | 실행 (AI 판단 없음) |
| AI 자율 판단 | **OpenClaw AI가 분석 후 결정** | ❌ 없음 |
| apply-decision.ts | **AI 결정 적용** | ❌ 실행 안 함 |

> **직접 실행 모드**에서는 AI 판단이 없으므로 analyzer의 원래 시그널이 그대로 trader에게 전달된다.

---

## 7. AI 판단 전략 유형

OpenClaw AI가 판단할 때 사용하는 주요 전략 패턴:

| 패턴 | 조건 | 판단 |
|------|------|------|
| **순방향 합류** | 기술적 LONG + 스마트머니 롱 + 군중 숏 | LONG 승인 (높은 confidence) |
| **역발상 진입** | 기술적 LONG + 군중 extreme_long | HOLD (과열 경고) |
| **펀딩비 수취** | 펀딩비 > 0.01% + 기술적 SHORT | SHORT 승인 + 펀딩 수취 보너스 |
| **스퀴즈 포착** | OI 급증 + 가격 하락 + 군중 숏 | LONG 검토 (숏 스퀴즈) |
| **과열 회피** | 기술적 LONG + 모든 심리 지표 롱 편향 | HOLD (contrarian 관점) |

---

## 관련 문서

- [02-data-agent.md](./02-data-agent.md) — 시장 심리 데이터 수집 API
- [03-analysis-agent.md](./03-analysis-agent.md) — 기술적 분석 (시그널 생성)
- [04-trade-agent.md](./04-trade-agent.md) — 거래 실행 (AI 필터링 소비)
- [07-data-flow.md](./07-data-flow.md) — 데이터 흐름
- [09-strategy.md](./09-strategy.md) — 전략 프리셋
