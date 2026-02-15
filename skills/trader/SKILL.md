---
name: trader
description: 매매 시그널을 검증하고 하이퍼리퀴드에서 주문을 실행하며 포지션을 관리합니다. 긴급 청산 기능을 포함합니다.
metadata: {"openclaw":{"requires":{"bins":["bun"]},"primaryEnv":"HYPERLIQUID_PRIVATE_KEY"}}
---

## 목적

`data/signals/latest.json`의 매매 시그널을 읽고, 리스크 규칙을 검증한 뒤
하이퍼리퀴드에서 실제 주문을 실행합니다. 결과는 SQLite DB에 기록합니다.

## 사용 시나리오

- cron 트레이딩 루프에서 analyzer 다음에 호출
- 사용자가 "지금 BTC 롱 진입해", "전체 포지션 청산해" 요청 시
- "현재 포지션 보여줘", "오늘 수익 얼마야?" 등 조회 시

## 실행 방법

주문 실행 (시그널 기반):
```
bun run {baseDir}/scripts/execute-trade.ts
```

포지션 모니터링 (SL/TP/트레일링 스탑 체크):
```
bun run {baseDir}/scripts/execute-trade.ts --action monitor
```

포지션 조회:
```
bun run {baseDir}/scripts/execute-trade.ts --action positions
```

전체 포지션 청산:
```
bun run {baseDir}/scripts/execute-trade.ts --action close-all --reason manual
```

긴급 청산 (Kill Switch):
```
bun run {baseDir}/scripts/execute-trade.ts --action emergency
```

일일 요약:
```
bun run {baseDir}/scripts/execute-trade.ts --action daily-summary
```

## 입력

- `data/signals/latest.json` — 최신 매매 시그널

## 출력

- SQLite `trades` 테이블에 거래 기록
- stdout에 실행 결과 JSON

## 안전장치

- `data/KILL_SWITCH` 파일 존재 시 모든 거래 즉시 중지 후 전량 청산
- 일일 최대 손실(5%) 초과 시 자동 중지
- 연속 API 에러 5회 시 비상 중지
- 1분 내 5% 이상 급변 시 비상 모드

## 리스크 규칙

- 거래당 최대 리스크: 잔고의 2%
- 최대 포지션: 잔고의 10%
- 동시 포지션: 최대 3개
- 일일 최대 거래: 50회
- 기본 레버리지: 5x (최대 10x)

## 설정

`config.yaml`의 `trade_agent` 섹션 참조.
