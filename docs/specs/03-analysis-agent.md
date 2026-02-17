# 03 - analyzer 스킬 (분석)

## 1. 개요

`analyzer` 스킬은 가격 스냅샷을 분석하여 매매 시그널을 생성한다. 바이낸스-하이퍼리퀴드 스프레드 분석, 기술적 지표(RSI, MACD, 볼린저밴드, MA), 추세 판단을 종합하여 LONG/SHORT/HOLD 결정을 내린다.

---

## 2. SKILL.md

```markdown
---
name: analyzer
description: 가격 스냅샷을 분석하여 기술적 지표와 스프레드를 기반으로 매매 시그널(LONG/SHORT/HOLD)을 생성합니다.
metadata: {"openclaw":{"requires":{"bins":["bun"]}}}
---

## 목적

`data/snapshots/latest.json`의 가격 데이터를 분석하여 매매 시그널을
`data/signals/latest.json`에 저장합니다.

## 사용 시나리오

- cron 트레이딩 루프에서 data-collector 다음에 호출
- 사용자가 "현재 시장 분석해줘", "BTC 방향성 어때?" 요청 시

## 실행 방법

`exec` 도구로 실행:

```
bun run {baseDir}/scripts/analyze.ts
```

## 입력

- `data/snapshots/latest.json` — 최신 가격 스냅샷

## 출력

- `data/signals/latest.json` — 매매 시그널

## 시그널 형태

```json
{
  "timestamp": "...",
  "symbol": "BTC",
  "action": "LONG",
  "confidence": 0.78,
  "entry_price": 65420.50,
  "stop_loss": 65100.00,
  "take_profit": 65900.00,
  "analysis": {
    "spread": { "value_pct": 0.0177, "signal": "LONG_BIAS" },
    "rsi": { "value": 42.3, "signal": "NEUTRAL" },
    "macd": { "histogram": 12.5, "signal": "LONG" },
    "bollinger": { "position": "middle", "signal": "NEUTRAL" },
    "ma": { "signal": "STRONG_LONG" },
    "composite_score": 0.85
  }
}
```

## 분석 로직 요약

1. **스프레드 분석**: 바이낸스가 높으면 LONG_BIAS, 낮으면 SHORT_BIAS
2. **RSI(14)**: 30 이하 LONG, 70 이상 SHORT
3. **MACD(12,26,9)**: 골든크로스 LONG, 데드크로스 SHORT
4. **볼린저밴드(20,2)**: 하단 이탈 LONG, 상단 이탈 SHORT
5. **이동평균(7,25,99)**: 정배열 STRONG_LONG, 역배열 STRONG_SHORT
6. 가중 합산 → 임계값 초과 시 시그널 생성

## 설정

`config.yaml`의 `analysis_agent` 섹션에서 지표 파라미터, 가중치, 임계값 조정 가능.
```

---

## 3. 분석 파이프라인

```
PriceSnapshot → 스프레드 분석 → 기술적 지표 → 복합 점수 → TradeSignal
```

### 3.1 복합 점수 산출

기본 가중치는 아래와 같으며, **전략 프리셋**(`src/strategies/presets.ts`)에 따라 오버라이드된다:

```typescript
// 기본 가중치 (Balanced 기준)
const WEIGHTS = {
  spread: 0.30,    // 핵심 전략
  rsi: 0.15,
  macd: 0.20,
  bollinger: 0.15,
  ma: 0.20,
};

const SCORE_MAP: Record<string, number> = {
  STRONG_LONG: 2, LONG: 1, LONG_BIAS: 1,
  NEUTRAL: 0,
  SHORT_BIAS: -1, SHORT: -1, STRONG_SHORT: -2,
};

// 진입 임계값 — 전략별로 다름:
//   Conservative: 0.5 (엄격)
//   Balanced:     0.3 (기본)
//   Aggressive:   0.15 (적극)
// composite_score >= threshold → LONG
// composite_score <= -threshold → SHORT
// 그 외 → HOLD
```

> **전략 적용**: `analyze.ts` 실행 시 `config.yaml`의 `general.strategy` 값을 읽고, 해당 전략의 `analysisOverrides`(가중치, RSI 기간/임계값 등)를 기본 설정에 병합하여 분석한다. 상세는 [09-strategy.md](./09-strategy.md) 참조.

### 3.2 손절/익절 (ATR 기반)

```typescript
// ATR(14) × 배수로 손절/익절 계산
stop_loss = entry_price - atr * 2.0   // LONG 기준
take_profit = entry_price + atr * 3.0
```

---

## 4. TradeSignal 타입

```typescript
// src/models/trade-signal.ts
export interface TradeSignal {
  timestamp: string;
  symbol: string;
  action: "LONG" | "SHORT" | "HOLD";
  confidence: number;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  analysis: {
    spread: { value_pct: number; direction: string; signal: string };
    rsi: { value: number; signal: string };
    macd: { histogram: number; signal: string };
    bollinger: { position: string; signal: string };
    ma: { ma_7: number; ma_25: number; ma_99: number; signal: string };
    composite_score: number;
  };
  risk: { risk_reward_ratio: number; max_position_pct: number };
}
```

---

## 5. 설정 (config.yaml)

```yaml
analysis_agent:
  spread:
    threshold_high: 0.05
    threshold_extreme: 0.15
    lookback_count: 60
  indicators:
    rsi: { period: 14, overbought: 70, oversold: 30 }
    macd: { fast: 12, slow: 26, signal: 9 }
    bollinger: { period: 20, std_dev: 2.0 }
    ma: { short: 7, medium: 25, long: 99 }
  weights:
    spread: 0.30
    rsi: 0.15
    macd: 0.20
    bollinger: 0.15
    ma: 0.20
  signal:
    entry_threshold: 0.5
    min_confidence: 0.4
    cooldown_seconds: 30
  risk:
    atr_period: 14
    stop_loss_multiplier: 2.0
    take_profit_multiplier: 3.0
    min_risk_reward_ratio: 1.5
```

---

## 6. AI 자율 판단과의 연계

`analyzer`가 생성한 시그널(`data/signals/latest.json`)은 **ai-decision** 스킬에 의해 추가 필터링된다:

```
analyze.ts 출력 (기술적 분석)
     │
     ▼ data/signals/latest.json
     │
summarize.ts (기술적 분석 + 시장 심리 종합)
     │
     ▼ OpenClaw AI가 분석 후 결정
     │
apply-decision.ts (AI 결정 적용)
     │
     ▼ data/signals/latest.json (AI 필터링 완료)
     │
execute-trade.ts (AI가 승인한 시그널만 실행)
```

### 6.1 AI 필터링 후 시그널 변화

```json
{
  "symbol": "BTC",
  "action": "LONG",
  "confidence": 0.85,
  "ai_reviewed": true,
  "ai_review_at": "2026-02-16T12:00:00Z",
  "ai_reason": "RSI 30 반등 + 스마트머니 롱 + 군중 숏 치우침(역발상) + 펀딩비 음수(수취 유리)",
  "ai_summary": "기술적 분석과 시장 심리 모두 롱 방향 합류"
}
```

AI가 거부한 시그널은 `action: "HOLD"`로 변경되며, `ai_reason`에 거부 사유가 기록된다.

> **상세:** AI 자율 판단 시스템의 전체 스펙은 [10-ai-decision.md](./10-ai-decision.md) 참조.

---

## 7. 스크립트 구조

```
skills/analyzer/
├── SKILL.md
└── scripts/
    └── analyze.ts

skills/ai-decision/                # AI 판단 후처리 (NEW)
└── scripts/
    ├── collect-sentiment.ts       # 시장 심리 수집
    ├── summarize.ts               # 종합 요약
    └── apply-decision.ts          # AI 결정 적용
```

---

## 관련 문서

- [02-data-agent.md](./02-data-agent.md) — data-collector 스킬 (데이터 제공자)
- [04-trade-agent.md](./04-trade-agent.md) — trader 스킬 (시그널 소비자)
- [10-ai-decision.md](./10-ai-decision.md) — AI 자율 투자 판단 시스템
