---
name: data-collector
description: 바이낸스 선물과 하이퍼리퀴드에서 실시간 가격 데이터를 수집하고 표준화된 스냅샷을 생성합니다.
metadata: {"openclaw":{"requires":{"bins":["bun"]}}}
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
