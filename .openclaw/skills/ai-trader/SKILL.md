---
name: ai-trader
description: "HyperLiquid 자동 거래봇. 바이낸스 선물 가격 분석 → 시그널 생성 → AI 자율 판단 → 자동 매매. 투자 현황 조회, 포지션 관리, 전략 변경, 긴급 청산 지원."
metadata:
  {
    "openclaw":
      {
        "emoji": "📈",
        "requires": { "bins": ["bun"] },
      },
  }
---

# AI Trader Skill

HyperLiquid 자동 거래봇을 운영하고 투자 현황을 관리합니다.

**프로젝트 경로:** `/Users/kevin/Documents/GitHub/ai-trader`
**대시보드:** `http://localhost:5173` (SvelteKit)
**설정 파일:** `/Users/kevin/Documents/GitHub/ai-trader/config.yaml`

모든 명령은 프로젝트 디렉토리에서 실행해야 합니다:

```bash
cd /Users/kevin/Documents/GitHub/ai-trader
```

---

## ★ 핵심 규칙 ★

**이 봇은 완전 자율 모드로 운영됩니다.**

1. **질문 금지** — 사용자에게 절대 되묻지 않는다. A/B/C 선택지 제시 금지.
2. **즉시 실행** — 모든 단계를 직접 실행하고 결과만 보고한다.
3. **자율 판단** — 데이터를 분석하고, 최선의 판단을 스스로 내린다.
4. **오류 복구** — 실패 시 1회 재시도, 그래도 실패면 건너뛰고 보고한다.
5. **파라미터 조정** — 거래 대상이 없으면 원인 분석 후 파라미터를 직접 조정한다.

---

## AI 자율 투자 판단 파이프라인 (7단계)

"자동매매", "1회 실행", "파이프라인 실행" 요청 시 아래 7단계를 순서대로 실행합니다.
**각 단계를 실제로 셸에서 실행해야 합니다. 텍스트 응답만 하지 마세요.**

### 1단계: 가격 수집

```bash
cd /Users/kevin/Documents/GitHub/ai-trader && bun run skills/data-collector/scripts/collect-prices.ts
```

바이낸스 선물 + 하이퍼리퀴드에서 코인 가격을 수집합니다.

### 2단계: 기술적 분석

```bash
cd /Users/kevin/Documents/GitHub/ai-trader && bun run skills/analyzer/scripts/analyze.ts
```

5개 기술 지표(스프레드, RSI, MACD, 볼린저, MA)로 분석하여 LONG/SHORT/HOLD 시그널을 생성합니다.

### 3단계: 시장 심리 수집

```bash
cd /Users/kevin/Documents/GitHub/ai-trader && bun run skills/ai-decision/scripts/collect-sentiment.ts
```

각 코인별 시장 심리 데이터를 수집합니다:
- **바이낸스**: 오픈인터레스트(OI), 롱/숏 비율, 탑트레이더 포지션, 테이커 매수/매도 비율
- **하이퍼리퀴드**: 펀딩비, OI, 프리미엄, 24시간 거래량

### 4단계: AI 자율 판단 (핵심)

```bash
cd /Users/kevin/Documents/GitHub/ai-trader && bun run skills/ai-decision/scripts/summarize.ts
```

이 명령의 결과(JSON)를 읽고, 기술적 분석 + 시장 심리를 종합하여 **AI가 독립적으로** 투자 결정을 내립니다.

**판단 기준:**
- **composite_score** + 개별 지표 방향 일치 = 강한 신호
- **군중 역발상**: crowd_bias가 극단적(extreme_long/short)이면 반대 방향 고려
- **스마트 머니 추종**: 탑트레이더(상위 20%) 방향을 우선
- **펀딩비 전략**: 극단적 펀딩비(>0.01%/<-0.01%)는 반대 방향 포지션에 유리
- **OI 분석**: OI 급증 + 가격 역방향 = 스퀴즈 가능성
- **다중 합류**: 여러 데이터가 같은 방향을 가리킬 때만 진입
- 동일 코인 중복 포지션 금지, 최대 포지션 수 준수

판단 후 즉시 실행:

```bash
cd /Users/kevin/Documents/GitHub/ai-trader && bun run skills/ai-decision/scripts/apply-decision.ts --decisions '<JSON 배열>'
```

형식: `[{"symbol":"BTC","action":"LONG","confidence":0.7,"reason":"근거"}]`
HOLD로 판단된 코인은 배열에 포함하지 않습니다.

#### 거래 대상이 없을 경우

모든 코인이 HOLD로 나오면:
1. 왜 진입 조건을 충족하지 못했는지 분석
2. 현재 시장 상황에 맞게 파라미터 직접 조정 (범위: entry_threshold 0.25~0.50, min_confidence 0.20~0.45, ±0.05 이내)
3. 조정 내용을 기록:

```bash
cd /Users/kevin/Documents/GitHub/ai-trader && echo '{"timestamp":"<ISO>","reason":"사유","adjustments":{"entry_threshold":{"from":0.40,"to":0.35}},"market_condition":"sideways","action_taken":"lowered_threshold"}' > data/ai-adjustments.json
```

4. 2단계부터 재실행 (재분석 → 재판단)
5. 재시도에서도 HOLD이면 "현재 시장 진입 불가" 결론 + 파라미터 복원

### 5단계: 자금 리밸런싱

```bash
cd /Users/kevin/Documents/GitHub/ai-trader && bun run skills/wallet-manager/scripts/manage-wallet.ts --action auto-rebalance
```

### 6단계: 거래 실행

```bash
cd /Users/kevin/Documents/GitHub/ai-trader && bun run skills/trader/scripts/execute-trade.ts
```

### 7단계: 결과 보고

실행 결과를 간결하게 보고합니다 (이 형식만 사용):
- **진입**: [코인] [방향] [근거 1줄] (없으면 "없음")
- **파라미터 조정**: [변경 내용] (없으면 "없음")
- **시장**: [bullish/bearish/sideways] [근거 1줄]
- **오류**: [있으면 내용] (없으면 "없음")

**보고 후 추가 질문/선택지/확인 요청 금지. 즉시 종료.**

---

## 투자 현황 조회

사용자가 "투자 현황", "수익", "포지션", "잔고" 등을 물으면:

### 포지션 조회

```bash
cd /Users/kevin/Documents/GitHub/ai-trader && bun run skills/trader/scripts/execute-trade.ts --action positions
```

### 일일 요약

```bash
cd /Users/kevin/Documents/GitHub/ai-trader && bun run skills/trader/scripts/execute-trade.ts --action daily-summary
```

### 잔고 확인

```bash
curl -s http://localhost:5173/api/balances
```

---

## 전략 관리

현재 3종 전략: conservative(보수적), balanced(균형), aggressive(공격적)

### 전략 변경

```bash
curl -s -X POST http://localhost:5173/api/bot/strategy -H 'Content-Type: application/json' -d '{"strategy":"[이름]"}'
```

---

## 안전 관리

### 긴급 청산

```bash
cd /Users/kevin/Documents/GitHub/ai-trader && bun run skills/trader/scripts/execute-trade.ts --action emergency
```

### 전체 청산

```bash
cd /Users/kevin/Documents/GitHub/ai-trader && bun run skills/trader/scripts/execute-trade.ts --action close-all --reason manual
```

### 개별 포지션 청산

```bash
cd /Users/kevin/Documents/GitHub/ai-trader && bun run skills/trader/scripts/execute-trade.ts --action close-position --coin [코인] --side [LONG|SHORT]
```

### Kill Switch

```bash
# 확인
ls /Users/kevin/Documents/GitHub/ai-trader/data/KILL_SWITCH 2>/dev/null && echo "ACTIVE" || echo "OFF"
# 해제
rm /Users/kevin/Documents/GitHub/ai-trader/data/KILL_SWITCH
```

---

## 포지션 모니터링

```bash
cd /Users/kevin/Documents/GitHub/ai-trader && bun run skills/trader/scripts/execute-trade.ts --action monitor
```

열린 포지션의 SL/TP/트레일링 스탑을 체크하고 청산 조건을 확인합니다.

---

## 연속 실행 (Runner)

### 1회 실행

```bash
cd /Users/kevin/Documents/GitHub/ai-trader && bun run src/runner.ts --once
```

### 러너 상태

```bash
cat /tmp/ai-trader-runner-status.json 2>/dev/null || echo "Runner not active"
```
