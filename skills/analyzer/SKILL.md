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
