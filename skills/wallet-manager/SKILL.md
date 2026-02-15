---
name: wallet-manager
description: 코인베이스 Agentic Wallet(awal CLI)과 하이퍼리퀴드 잔고를 관리하고 자금 이동을 처리합니다.
metadata: {"openclaw":{"requires":{"bins":["bun","npx"]}}}
---

## 목적

코인베이스 Agentic Wallet과 하이퍼리퀴드 거래 계좌의 잔고를 모니터링하고,
필요 시 자금을 이동합니다.

## 사전 조건

Agentic Wallet 인증이 완료되어야 합니다:
```
bunx awal auth login your@email.com
bunx awal auth verify <flowId> <code>
```

## 사용 시나리오

- 사용자가 "잔고 확인해", "코인베이스에서 하이퍼리퀴드로 500 USDC 보내줘" 요청 시
- trader 스킬에서 잔고 부족으로 자금 요청이 발생했을 때
- cron 작업에서 주기적 잔고 확인 시

## 실행 방법

잔고 조회:
```
bun run {baseDir}/scripts/manage-wallet.ts --action balance
```

자금 충전 (코인베이스 → 하이퍼리퀴드):
```
bun run {baseDir}/scripts/manage-wallet.ts --action fund --amount 500
```

자금 인출 (하이퍼리퀴드 → 코인베이스):
```
bun run {baseDir}/scripts/manage-wallet.ts --action withdraw --amount 500
```

대기 중인 자금 요청 처리:
```
bun run {baseDir}/scripts/manage-wallet.ts --action process-requests
```

자동 충전 (하이퍼리퀴드 잔고 부족 시):
```
bun run {baseDir}/scripts/manage-wallet.ts --action auto-fund
```

일일 리포트:
```
bun run {baseDir}/scripts/manage-wallet.ts --action daily-report
```

## 출력

- stdout에 잔고/전송 결과 JSON
- SQLite `wallet_transfers` 테이블에 이동 기록
- SQLite `balance_snapshots` 테이블에 잔고 스냅샷

## 보안

- 모든 전송은 화이트리스트 주소로만 가능
- 단일 전송 최대 1,000 USDC
- 일일 전송 최대 5,000 USDC
- 코인베이스/하이퍼리퀴드 최소 보유 잔고 강제
- Agentic Wallet 자체 KYT 스크리닝 + 지출 가드레일

## 설정

`config.yaml`의 `wallet_agent` 섹션 참조.
