# HEARTBEAT.md

## AI Trader 자동 모니터링

하트비트 시 아래를 확인하세요 (2-3시간마다, 자동매매 실행 중일 때만):

### 1. Kill Switch 확인

```bash
ls /Users/kevin/Documents/GitHub/ai-trader/data/KILL_SWITCH 2>/dev/null && echo "ACTIVE" || echo "OFF"
```

ACTIVE이면 즉시 텔레그램으로 알림:
"⚠️ Kill Switch가 활성화되어 있습니다. 자동매매가 중단된 상태입니다."

### 2. Runner 상태 확인

```bash
cat /tmp/ai-trader-runner-status.json 2>/dev/null
```

- `state`가 `error`이면 텔레그램으로 알림: "❌ Runner 에러 발생: [에러 내용]"
- `state`가 `stopped`인데 예상 밖이면 알림: "⚠️ Runner가 예기치 않게 중단되었습니다"
- Runner 파일이 없으면 자동매매가 꺼진 상태 → 조용히 넘어감

### 3. 큰 손실 감지

Runner가 실행 중이면 일일 요약을 확인:

```bash
cd /Users/kevin/Documents/GitHub/ai-trader && bun run skills/trader/scripts/execute-trade.ts --action daily-summary 2>/dev/null
```

일일 손실이 잔고의 10% 이상이면 텔레그램으로 경고:
"🚨 일일 손실이 10%를 초과했습니다! 현재 PnL: -$XX.XX (-XX%). 긴급 청산을 원하시면 '긴급 청산'이라고 입력하세요."

### 4. 포지션 모니터 상태

```bash
cat /tmp/ai-trader-position-monitor.json 2>/dev/null
```

포지션 모니터가 실행 중이어야 하는데 멈춰 있으면 알림:
"⚠️ 포지션 모니터가 중단되었습니다. 자동매매를 재시작하세요."

## 알림 규칙

- 문제가 없으면 **HEARTBEAT_OK**로 조용히 넘어가세요
- 심야 시간(23:00-08:00)에는 Kill Switch/큰 손실만 알립니다
- 같은 알림을 반복하지 마세요 (memory/heartbeat-state.json에 마지막 알림 시간 기록)
- 텔레그램으로 알림을 보낼 때는 message 도구를 사용합니다
