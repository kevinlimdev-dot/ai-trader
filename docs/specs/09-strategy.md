# 09 - 투자 전략 시스템

## 1. 개요

봇은 **3종 투자 전략 프리셋**을 지원하며, 대시보드에서 실시간으로 전략을 전환할 수 있다.
각 전략은 분석 파라미터(지표 가중치, 진입 임계값, RSI 범위 등)와 거래 파라미터(레버리지, 리스크, 손절/익절, 트레일링 스탑 등)를 패키지로 제공한다.

`config.yaml`의 `general.strategy` 값으로 전략을 선택하면, 분석기(analyzer)와 트레이더(trader)가 해당 프리셋의 파라미터를 자동으로 적용한다.

---

## 2. 전략 프리셋

### 2.1 Conservative (보수적)

**특징:** 높은 진입 장벽, 낮은 거래 빈도, 안전 우선

- 확실한 시그널만 진입 (composite score >= 0.5)
- 낮은 레버리지 (5x), 작은 포지션 (2%)
- 넓은 손절 (2x ATR)로 노이즈 회피
- 최대 5개 동시 포지션

**적합 대상:** 자본 보존 중시, 장기 운용, 큰 자금

### 2.2 Balanced (균형)

**특징:** 적절한 거래 빈도, 균형 잡힌 리스크-리워드

- 중간 진입 장벽 (composite score >= 0.3)
- 중간 레버리지 (7x), 중간 포지션 (3%)
- 균형 손절 (1.5x ATR) / 익절 (3x ATR)
- 최대 8개 동시 포지션

**적합 대상:** 일반적인 자동매매, 중간 자금

### 2.3 Aggressive (공격적 모멘텀)

**특징:** 높은 거래 빈도, 모멘텀 추종, 고수익-고위험

- 낮은 진입 장벽 (composite score >= 0.15)
- 높은 레버리지 (10x~20x), 큰 포지션 (5%)
- 타이트한 손절 (1x ATR) + 넓은 익절 (4x ATR) = R:R 4.0
- 빠른 트레일링 활성화 (0.7%)로 수익 보호
- MACD + MA 가중치 증대 → 모멘텀 추종 강화
- 최대 15개 동시 포지션

**적합 대상:** 고수익 추구, 소규모 자금으로 빠른 성장

---

## 3. 파라미터 비교표

### 3.1 분석 파라미터 (Analysis Agent)

| 파라미터 | Conservative | Balanced | Aggressive |
|---|---|---|---|
| entry_threshold | 0.5 | 0.3 | 0.15 |
| min_confidence | 0.4 | 0.25 | 0.1 |
| cooldown_seconds | 60 | 30 | 10 |
| RSI overbought | 70 | 65 | 60 |
| RSI oversold | 30 | 35 | 40 |
| weight: spread | 0.30 | 0.25 | 0.15 |
| weight: rsi | 0.15 | 0.15 | 0.15 |
| weight: macd | 0.20 | 0.25 | 0.30 |
| weight: bollinger | 0.15 | 0.10 | 0.10 |
| weight: ma | 0.20 | 0.25 | 0.30 |

### 3.2 거래 파라미터 (Trade Agent)

| 파라미터 | Conservative | Balanced | Aggressive |
|---|---|---|---|
| leverage (default) | 5x | 7x | 10x |
| leverage (max) | 10x | 15x | 20x |
| risk_per_trade | 2% | 3% | 5% |
| max_position_pct | 10% | 15% | 25% |
| max_concurrent_positions | 5 | 8 | 15 |
| max_daily_trades | 100 | 200 | 500 |
| max_daily_loss | 5% | 8% | 15% |
| SL multiplier (ATR) | 2.0x | 1.5x | 1.0x |
| TP multiplier (ATR) | 3.0x | 3.0x | 4.0x |
| R:R ratio | 1.5 | 2.0 | 4.0 |
| trailing activation | 1.5% | 1.0% | 0.7% |
| trailing trail | 0.8% | 0.5% | 0.3% |
| signal_max_age_sec | 60 | 45 | 30 |

---

## 4. 아키텍처

### 4.1 데이터 흐름

```
Dashboard                     config.yaml
   │ POST /api/bot/strategy      │
   └──────────────────────────▶  │ general.strategy: "aggressive"
                                 │
                                 ▼
                          presets.ts
                       ┌─────────────────┐
                       │ getStrategyPreset│
                       │ ("aggressive")  │
                       └────┬───────┬────┘
                            │       │
              ┌─────────────┘       └──────────────┐
              ▼                                    ▼
        analyze.ts                          execute-trade.ts
   ┌──────────────────┐               ┌──────────────────┐
   │ weights 오버라이드 │               │ leverage 오버라이드│
   │ RSI 범위 오버라이드│               │ risk 오버라이드    │
   │ entry_threshold   │               │ SL/TP 오버라이드  │
   │ cooldown          │               │ trailing 오버라이드│
   └────────┬─────────┘               └────────┬─────────┘
            │                                  │
            │ data/signals/latest.json         │
            └──────────────────────────────────┘
```

### 4.2 프리셋 적용 방식

프리셋은 `config.yaml`의 기존 값을 **오버라이드**하는 방식으로 적용된다.

1. `loadConfig()`로 기본 설정 로드
2. `general.strategy` 값으로 프리셋 로드
3. 프리셋 파라미터가 config 값을 덮어씌움
4. 사용자가 config.yaml에 직접 설정한 값은 프리셋보다 우선하지 않음 (프리셋이 항상 우선)

이 방식은 전략 전환 시 일관된 파라미터 세트를 보장한다.

---

## 5. 설정

### 5.1 config.yaml

```yaml
general:
  mode: live
  strategy: balanced      # conservative | balanced | aggressive
  log_level: info
  timezone: Asia/Seoul
```

### 5.2 전략별 예상 동작

**Conservative:**
- 50개 코인 중 1~3개만 시그널 발생 (매우 선별적)
- 하루 거래 횟수: 0~10회
- 소규모 포지션, 느린 리밸런싱

**Balanced:**
- 50개 코인 중 5~15개 시그널 발생
- 하루 거래 횟수: 10~50회
- 중간 크기 포지션, 적당한 거래 빈도

**Aggressive:**
- 50개 코인 중 20~40개 시그널 발생 (대부분 진입)
- 하루 거래 횟수: 50~200회
- 대규모 포지션, 빈번한 진입/청산, 빠른 트레일링

---

## 6. 구현 파일

| 파일 | 변경 유형 | 내용 |
|---|---|---|
| `src/strategies/presets.ts` | 신규 | 3종 전략 프리셋 상수, `getStrategyPreset()` 함수 |
| `src/utils/config.ts` | 수정 | `AppConfig.general.strategy` 타입 추가 |
| `config.yaml` | 수정 | `general.strategy` 필드 추가 |
| `skills/analyzer/scripts/analyze.ts` | 수정 | 프리셋 weights/thresholds 적용 |
| `skills/trader/scripts/execute-trade.ts` | 수정 | 프리셋 leverage/risk/SL/TP 적용 |
| `dashboard/src/routes/api/bot/strategy/+server.ts` | 신규 | GET/POST 전략 API |
| `dashboard/src/routes/+page.svelte` | 수정 | 전략 선택 UI |

---

## 7. 대시보드 UI

### 7.1 전략 선택

헤더 영역에 3개 버튼 그룹으로 표시:

```
[ Conservative ]  [ Balanced ]  [ Aggressive ]
                       ▲ (현재 선택)
```

선택 시 즉시 `config.yaml`이 업데이트되며, 다음 사이클부터 새 전략이 적용된다.

### 7.2 전략 요약 표시

현재 선택된 전략의 핵심 파라미터를 카드로 표시:

```
Strategy: Aggressive
Leverage: 10x  |  Risk: 5%  |  R:R: 4.0  |  Max Positions: 15
```

---

## 8. 안전장치

- **전략 변경은 다음 사이클부터 적용** — 진행 중인 사이클에는 영향 없음
- **기존 포지션은 변경 전 전략의 SL/TP를 유지** — 진행 중인 거래의 리스크 파라미터가 갑자기 바뀌지 않음
- **Kill Switch는 모든 전략에 우선** — 킬스위치 활성 시 어떤 전략이든 거래 중단
- **max_daily_loss 초과 시 해당 전략 전용 일일 한도 적용** — Aggressive라도 일일 최대 손실을 넘지 않음
