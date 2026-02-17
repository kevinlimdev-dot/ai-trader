# 01 - 프로젝트 개요

## 1. 프로젝트 목적

**AI Trader**는 바이낸스 선물(Binance Futures) 가격 데이터를 실시간으로 수집하고, 하이퍼리퀴드(HyperLiquid) 거래소와의 가격 차이를 분석하여 방향성을 예측한 뒤, 하이퍼리퀴드에서 자동으로 매매하는 트레이딩 봇이다.

OpenClaw Gateway 위에서 구동되며, 스킬(Skill) 기반으로 데이터 수집, 분석, 거래, 자금 관리 기능을 모듈화한다. **SvelteKit 기반 웹 대시보드**를 통해 실시간 모니터링, 거래 제어, 지갑 관리가 가능하다. Telegram 알림도 지원한다.

### 핵심 전략

1. **멀티타임프레임 합류 분석**: 4h(추세) + 1h(과매수/과매도) + 15m(진입 타이밍) + 실시간(스프레드)
2. **바이낸스-하이퍼리퀴드 스프레드**: 두 거래소 간 가격 차이로 방향성 힌트 수집 (임계값: 0.1%/0.5%)
3. **기술적 분석 + 시장 심리 + AI 자율 판단 + 과거 성과 피드백**을 결합하여 방향성을 최종 확정
4. **R:R 2.0 이상** 확보: ATR 기반 SL/TP (1h ATR 활용, SL 1.5x / TP 3.0x)

---

## 2. 시스템 아키텍처

### OpenClaw Gateway 기반 구조

OpenClaw는 로컬 머신에서 실행되는 **Gateway 데몬**이다. Gateway가 AI 모델(GPT-5-mini)을 "두뇌"로 사용하고, 내장 도구(`exec`, `read`, `write` 등)와 스킬(`SKILL.md`)을 통해 실제 작업을 수행한다.

```
┌─────────────────────────────────────────────────────────────────┐
│                     OpenClaw Gateway (데몬)                      │
│                                                                 │
│  ┌────────────────────────────────────────────────────────┐     │
│  │       trader 에이전트 (전용, 완전 자율 실행)              │     │
│  │       워크스페이스: ai-trader 프로젝트 루트               │     │
│  │       모델: openai/gpt-5-mini                           │     │
│  └──────────────────────┬─────────────────────────────────┘     │
│                         │                                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│  │ data-    │  │ analyzer │  │ trader   │  │ wallet-      │   │
│  │ collector│  │ (스킬)    │  │ (스킬)    │  │ manager(스킬) │   │
│  │ (스킬)    │  │          │  │          │  │              │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬───────┘   │
│       │              │              │               │           │
│       ▼              ▼              ▼               ▼           │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │           exec 도구 → bun run scripts/*.ts              │   │
│  └─────────────────────────────────────────────────────────┘   │
└───────────────────────┬─────────────────────────────────────────┘
                        │
       ┌────────────────┼────────────────┐
       ▼                ▼                ▼
 ┌───────────┐  ┌─────────────┐  ┌──────────────────┐
 │  Binance   │  │ HyperLiquid │  │ Coinbase Agentic │
 │  Futures   │  │  Exchange   │  │     Wallet       │
 └───────────┘  └─────────────┘  └──────────────────┘
```

### OpenClaw 에이전트 구성

| 에이전트 | 역할 | 워크스페이스 |
|---------|------|------------|
| **trader** | 자동매매 전용 (7단계 파이프라인 자율 실행) | `~/Documents/GitHub/ai-trader` |
| **main** | 대화형 (Telegram 명령 등) | `~/.openclaw/workspace` |

`trader` 에이전트의 핵심 설정:
- `SOUL.md` — 완전 자율 실행, 질문 금지 원칙
- `AGENTS.md` — 스킬 기반 실행 규칙
- `.openclaw/skills/ai-trader/SKILL.md` — 7단계 파이프라인 정의
- `exec-approvals` — 모든 명령 실행 허용 (`*`)

### 핵심 개념

| 개념 | 설명 |
|------|------|
| **Gateway** | OpenClaw의 핵심 프로세스. Bun 런타임 위에서 실행되며 AI 모델, 채널, 도구를 관리 |
| **Skill** | `SKILL.md` 파일로 정의된 모듈. 에이전트에게 특정 작업 수행 방법을 가르침 |
| **Tool** | Gateway 내장 도구 (`exec`, `read`, `write`, `cron`, `web_fetch` 등) |
| **exec-approvals** | 에이전트별 셸 명령 실행 권한. `trader`는 `*` (모든 명령 허용) |
| **Channel** | 사용자와 에이전트 간 통신 수단 (Telegram, Discord, WebChat 등) |
| **Session** | 에이전트 대화 컨텍스트. Runner는 매 사이클마다 새 세션 ID 생성 |

---

## 3. 스킬 구성 (5개)

각 스킬은 `skills/` 디렉토리 아래에 TypeScript 스크립트로 구성된다. OpenClaw 에이전트는 `.openclaw/skills/ai-trader/SKILL.md`에 정의된 지침에 따라 `exec` 도구로 스크립트를 실행한다.

| 스킬 | 디렉토리 | 역할 | 연동 서비스 |
|------|---------|------|-----------|
| **data-collector** | `skills/data-collector/` | 바이낸스 선물 + 하이퍼리퀴드 가격 수집 | Binance Futures 공개 API (키 불필요), HyperLiquid Info API |
| **analyzer** | `skills/analyzer/` | 가격 차이 분석, 기술적 지표, 매매 시그널 생성 | 내부 데이터 |
| **ai-decision** | `skills/ai-decision/` | 시장 심리 수집 + AI 자율 투자 판단 + 시그널 필터링 | Binance Futures 공개 API (키 불필요), HyperLiquid, OpenClaw AI |
| **trader** | `skills/trader/` | 하이퍼리퀴드 주문 실행, 포지션 관리 | HyperLiquid Exchange API |
| **wallet-manager** | `skills/wallet-manager/` | HyperLiquid 잔고 모니터링 + Coinbase Agentic Wallet 자금 리밸런싱 | HyperLiquid, Coinbase Agentic Wallet |

---

## 4. 기술 스택

### OpenClaw

- **OpenClaw Gateway** — AI 에이전트 프레임워크 (**Bun 런타임**)
  - 설치: `bun add -g openclaw`
  - 셋업: `openclaw configure`
  - 에이전트 관리: `openclaw agents list` / `openclaw agents add`
  - 실행 권한: `openclaw approvals allowlist add`
  - 모델: `openai/gpt-5-mini`

### 언어 및 런타임

- **Bun** — OpenClaw Gateway 런타임 + TypeScript 런타임 + 패키지 매니저 통합
  - 내장 SQLite (`bun:sqlite`)
- **TypeScript** — 트레이딩 로직 개발 언어

### 거래소 API

- **`@nktkas/hyperliquid`** — 하이퍼리퀴드 TypeScript SDK (100% TS, viem 호환)
- **Binance Futures REST API** — 바이낸스 선물 공개 REST API (API 키 불필요, 경량 직접 호출)

### 지갑 / 입금

- **HyperLiquid 입금** — Arbitrum USDC를 HyperLiquid 입금 주소로 직접 입금
- **Coinbase Agentic Wallet** — AI 에이전트 전용 보조 지갑 (Base 네트워크). 자동 리밸런싱에 활용

### 데이터베이스

- **`bun:sqlite`** — Bun 내장 SQLite (거래 이력, 스냅샷 저장)

---

## 5. 실행 흐름 요약

### 5.1 트레이딩 파이프라인 (7단계 + 독립 모니터)

Runner (`src/runner.ts`)가 OpenClaw `trader` 에이전트를 호출하여 파이프라인을 실행한다. 에이전트는 `.openclaw/skills/ai-trader/SKILL.md`를 읽고 7단계를 자율적으로 실행한다:

```
[Runner → OpenClaw trader 에이전트 → SKILL.md 지침 따라 실행]

1. 가격 수집 (data-collector) — 멀티타임프레임
   └── bun run skills/data-collector/scripts/collect-prices.ts
       ├── 바이낸스 선물: 1m + 15m + 1h + 4h 캔들 수집 (Rate Limiter 적용)
       ├── 하이퍼리퀴드 가격 수집 (Rate Limiter 적용)
       └── DB + data/snapshots/latest.json 저장

2. 기술적 분석 (analyzer) — 지표별 최적 타임프레임
   └── bun run skills/analyzer/scripts/analyze.ts
       ├── 4h: MA(추세 방향) + MACD(추세 확인)
       ├── 1h: RSI(과매수/과매도) + Bollinger(변동성)
       ├── 15m: MACD 크로스(진입 타이밍)
       ├── 실시간: 스프레드 분석 (0.1%/0.5% 임계값)
       └── data/signals/latest.json 생성

3. 시장 심리 수집 (ai-decision)
   └── bun run skills/ai-decision/scripts/collect-sentiment.ts
       ├── 바이낸스: OI, 롱/숏 비율, 탑 트레이더 포지션, 테이커 매수/매도, 펀딩비
       ├── 하이퍼리퀴드: 펀딩비, OI, 프리미엄, 24시간 거래량
       └── data/sentiment/latest.json 저장

4. ★ AI 자율 투자 판단 (ai-decision) ★
   └── bun run skills/ai-decision/scripts/summarize.ts
       ├── 기술적 분석 + 시장 심리 + 현재 포지션 + 잔고 종합 요약
       ├── 과거 7일 성과 데이터 (승률, 심볼별/방향별 PnL, 연패 기록) 제공
       └── OpenClaw AI가 데이터를 분석하여 독립적 투자 결정
   └── bun run skills/ai-decision/scripts/apply-decision.ts --decisions '<JSON>'
       ├── AI가 승인/거부한 종목에 대해 시그널 파일 수정
       └── 기술적 근거 + 심리적 근거를 reason에 기록

   [거래 대상 없을 경우]
   └── AI가 파라미터(entry_threshold, min_confidence) 직접 조정
       ├── 범위: entry_threshold 0.25~0.50, min_confidence 0.20~0.45
       ├── 조정 내용: data/ai-adjustments.json에 기록
       └── 2단계부터 재실행 (재분석 → 재판단)

5. 자금 리밸런싱 (wallet-manager)
   └── bun run skills/wallet-manager/scripts/manage-wallet.ts --action auto-rebalance
       ├── Coinbase ↔ HyperLiquid 잔고 확인
       └── 잔고 부족 시 자동 충전

6. 거래 실행 (trader)
   └── bun run skills/trader/scripts/execute-trade.ts
       ├── AI가 승인한 시그널만 실행 (필터링 완료)
       ├── 에셋별 최대 레버리지 자동 클램프
       ├── 동일 코인 중복 포지션 방지 / 반대 방향 시 포지션 전환
       ├── 하이퍼리퀴드 주문 실행 (reduceOnly 슬리피지 3x 적용)
       └── SQLite 거래 로그 저장

7. 결과 보고
   └── 진입 종목, 파라미터 조정 내용, 시장 분위기, 오류 요약

[독립 프로세스 — Position Monitor]
   └── bun run src/position-monitor.ts
       ├── 15초 주기로 열린 포지션 SL/TP/트레일링 스탑 체크
       ├── 조건 충족 시 즉시 청산
       └── 포지션 없으면 5분 후 자동 종료
```

> **Runner 실행 방식:** Runner는 OpenClaw `trader` 에이전트를 `--agent trader --session-id trade-cycle-{timestamp}` 형태로 호출한다. 매 사이클마다 새 세션을 생성하여 이전 대화 컨텍스트가 누적되지 않도록 한다. OpenClaw 실패 시 직접 실행으로 자동 폴백한다.

> **AI 자율 판단:** 4단계에서 OpenClaw AI 에이전트가 기술적 지표(Spread, RSI, MACD, BB, MA)와 시장 심리(군중 편향, 스마트 머니, 펀딩비, OI, 테이커 압력)를 종합 분석하여 자율적으로 투자 결정을 내린다. 단일 지표가 아닌 **합류(confluence)** 기반 판단을 수행한다.

### 5.2 입금 흐름

```
[사용자 → HyperLiquid 입금]

1. 사용자가 Arbitrum 네트워크에 USDC 입금
2. 대시보드 또는 CLI에서 자동 입금 실행
   └── bun run skills/wallet-manager/scripts/deposit-to-hl.ts
       ├── Arbitrum USDC 잔고 확인
       ├── USDC ERC20 transfer → HyperLiquid Bridge2 컨트랙트
       └── ~1분 내 HyperLiquid Spot 계정 입금 완료
3. Unified Account에서 Spot USDC가 Perps 마진으로 자동 활용
```

### 5.3 웹 대시보드 제어

- **메인 대시보드**: KPI, 차트, 오픈 포지션, 최근 거래, AI 파라미터 조정 알림
- **자동매매 시작/정지**: OpenClaw `trader` 에이전트 또는 직접 실행 모드
- **1회 실행 (Run Once)**: 파이프라인 1회 실행 + 포지션 모니터 자동 시작
- **포지션 모니터**: 독립 시작/정지 제어
- **Paper/Live 모드 전환**: 대시보드에서 즉시 전환
- **전략 선택**: Conservative / Balanced / Aggressive (실시간 전환)
- **개별 포지션 청산**: 오픈 포지션 개별 또는 전체 청산
- **Arbitrum → HL 입금**: 대시보드에서 원클릭 입금
- **Kill Switch**: 긴급 거래 중단

### 5.4 대화 기반 (Telegram)

Telegram 봇을 통해 OpenClaw `main` 에이전트(ai-trader 스킬)에게 자연어 명령을 내릴 수 있다:

| 명령 | 동작 |
|------|------|
| "자동매매 시작" / "start" | Runner 연속 실행 시작 |
| "자동매매 정지" / "stop" | Runner 정지 |
| "1회 실행" / "run once" | 파이프라인 1회 실행 |
| "잔고" / "balance" | HyperLiquid + Coinbase 잔고 조회 |
| "포지션" / "positions" | 열린 포지션 조회 |
| "일일요약" / "daily" | 오늘의 거래 요약 |
| "전략 변경 aggressive" | 전략 프리셋 변경 |
| "긴급 청산" / "emergency" | Kill Switch + 전량 청산 |

---

## 6. 프로젝트 디렉토리 구조

```
ai-trader/
├── .openclaw/                   # OpenClaw 워크스페이스 설정
│   └── skills/
│       └── ai-trader/
│           └── SKILL.md         # 7단계 파이프라인 + 자율 판단 지침
├── SOUL.md                      # trader 에이전트 핵심 원칙 (자율 실행, 질문 금지)
├── AGENTS.md                    # trader 에이전트 워크스페이스 규칙
├── skills/                      # 트레이딩 스킬 (TypeScript 스크립트)
│   ├── data-collector/
│   │   └── scripts/
│   │       └── collect-prices.ts
│   ├── analyzer/
│   │   └── scripts/
│   │       └── analyze.ts
│   ├── ai-decision/
│   │   └── scripts/
│   │       ├── collect-sentiment.ts  # 시장 심리 데이터 수집
│   │       ├── summarize.ts          # AI 판단용 종합 요약
│   │       └── apply-decision.ts     # AI 결정 적용
│   ├── trader/
│   │   └── scripts/
│   │       └── execute-trade.ts
│   └── wallet-manager/
│       └── scripts/
│           ├── manage-wallet.ts
│           ├── deposit-to-hl.ts     # Arbitrum → HL 자동 입금
│           └── spot-to-perp.ts
├── src/                         # TypeScript 소스 코드
│   ├── runner.ts                # 연속 트레이딩 러너 (OpenClaw 오케스트레이터)
│   ├── position-monitor.ts      # 독립 포지션 모니터 (15초 주기)
│   ├── services/
│   │   ├── binance.service.ts   # 바이낸스 API + Rate Limiter + 시장 심리
│   │   ├── hyperliquid.service.ts # 하이퍼리퀴드 API (레버리지 클램프, 슬리피지)
│   │   └── coinbase.service.ts  # awal CLI 래퍼
│   ├── strategies/
│   │   └── presets.ts           # 전략 프리셋 (Conservative/Balanced/Aggressive)
│   ├── models/
│   │   ├── price-snapshot.ts
│   │   ├── trade-signal.ts
│   │   └── order.ts
│   ├── db/
│   │   ├── schema.ts
│   │   └── repository.ts
│   └── utils/
│       ├── config.ts
│       ├── logger.ts
│       ├── file.ts
│       ├── openclaw.ts          # OpenClaw 바이너리 탐지 + 에이전트 실행 (agentId, sessionId)
│       ├── rate-limiter.ts      # Token Bucket Rate Limiter
│       └── risk-manager.ts
├── dashboard/                   # 웹 대시보드 (SvelteKit)
│   ├── src/
│   │   ├── lib/
│   │   │   ├── server/
│   │   │   │   └── db.ts       # DB 접근, 실시간 잔고, HL 포지션 동기화
│   │   │   ├── components/      # Svelte 컴포넌트
│   │   │   │   ├── Sidebar.svelte
│   │   │   │   ├── KpiCard.svelte
│   │   │   │   ├── PriceChart.svelte
│   │   │   │   ├── TradesTable.svelte
│   │   │   │   ├── SignalBadge.svelte
│   │   │   │   └── SetupBanner.svelte
│   │   │   └── types.ts
│   │   └── routes/
│   │       ├── +page.svelte     # 메인 대시보드 (KPI, 차트, AI 조정, 포지션, 거래)
│   │       ├── positions/       # 포지션 관리
│   │       ├── trades/          # 거래 내역 (페이지네이션, 필터링)
│   │       ├── signals/         # 시그널 분석 (LONG/SHORT 아코디언, HOLD 접기)
│   │       ├── wallet/          # 지갑 (실시간 잔고, HL 상세, Arb→HL 입금)
│   │       ├── control/         # 봇 제어 (전략, 러너, 모니터, 개별 청산)
│   │       └── api/             # REST API 엔드포인트 (23개)
│   │           ├── bot/         # runner, monitor, strategy, deposit, close-position 등
│   │           ├── balances/    # 실시간 잔고
│   │           ├── dashboard/   # 대시보드 집계
│   │           └── ...          # trades, signals, positions, coins, ai-adjustments
│   └── svelte.config.js
├── data/                        # 런타임 데이터
│   ├── snapshots/
│   ├── signals/
│   ├── sentiment/
│   ├── ai-adjustments.json      # AI 파라미터 조정 기록
│   └── ai-trader.db
├── config.yaml
├── .env                         # 시크릿 (gitignore)
├── package.json
├── tsconfig.json
└── bunfig.toml
```

---

## 7. 기술 스택 요약

### 웹 대시보드

| 항목 | 기술 |
|------|------|
| **프레임워크** | SvelteKit (Svelte 5 runes) |
| **스타일링** | Tailwind CSS v4 |
| **차트** | Lightweight Charts |
| **런타임** | Bun (vite dev/build 모두 Bun) |
| **API** | SvelteKit server routes (`+server.ts`) × 23개 |
| **실시간** | 폴링 (3초/5초/10초 계층적 갱신) |

### 멀티타임프레임 분석 (v2)

| 타임프레임 | 역할 | 지표 |
|-----------|------|------|
| **4h** | 상위 추세 방향 | MA(7/25/99), MACD 히스토그램 |
| **1h** | 과매수/과매도 | RSI(14), Bollinger Bands, EMA21, ATR |
| **15m** | 진입 타이밍 | MACD 크로스, RSI 보조 확인 |
| **실시간** | 스프레드 | 바이낸스-HL 가격 차이 (0.1%/0.5% 임계값) |

### 스코어링 시스템

| 항목 | 값 |
|------|------|
| **STRONG_LONG/SHORT** | ±2 (멀티TF 합류) |
| **LONG/SHORT** | ±1 (단일 TF 명확) |
| **LONG_BIAS/SHORT_BIAS** | ±0.5 (약한 힌트) |
| **가중치** | MA(0.30) > MACD(0.25) > RSI(0.20) > Bollinger(0.15) > Spread(0.10) |
| **진입 임계값** | Balanced: 0.45 / Conservative: 0.55 / Aggressive: 0.30 |

### 거래소 API 쿼터 관리

| 항목 | 설정 |
|------|------|
| **알고리즘** | Token Bucket |
| **바이낸스** | 28 req/s, 버스트 120 (멀티TF 캔들 4개 × 31심볼 대응) |
| **하이퍼리퀴드** | 14 req/s (공식 20의 70% 안전 마진) |
| **429 대응** | Retry-After 헤더 존중 + 자동 대기 |

### 안전 장치

| 항목 | 설명 |
|------|------|
| **Kill Switch** | `data/KILL_SWITCH` 파일 존재 시 모든 거래 중단 |
| **레버리지 클램프** | 에셋별 최대 레버리지 자동 적용 (HyperLiquid 메타데이터) |
| **슬리피지 보호** | reduceOnly(청산) 주문은 3x 슬리피지 (최소 3%) |
| **중복 포지션 방지** | 동일 코인 같은 방향 포지션 차단, 반대 방향 시 자동 전환 |
| **연속 오류 정지** | 10회 연속 실패 시 Runner 자동 정지 |
| **포지션 모니터** | 15초 주기 독립 프로세스, SL/TP/트레일링 스탑 실시간 체크 |
| **과거 성과 피드백** | AI에 7일 승률/심볼별 PnL/연패 기록 제공 → 동적 보수화 |

---

## 8. 문서 네비게이션

| 문서 | 내용 |
|------|------|
| [01-overview.md](./01-overview.md) | 프로젝트 개요 (현재 문서) |
| [02-data-agent.md](./02-data-agent.md) | 데이터 수집 스킬 상세 스펙 |
| [03-analysis-agent.md](./03-analysis-agent.md) | 분석 스킬 상세 스펙 |
| [04-trade-agent.md](./04-trade-agent.md) | 거래 실행 스킬 상세 스펙 |
| [05-wallet-agent.md](./05-wallet-agent.md) | 지갑 관리 스킬 상세 스펙 |
| [06-config-and-deployment.md](./06-config-and-deployment.md) | OpenClaw 설정 및 배포 |
| [07-data-flow.md](./07-data-flow.md) | 데이터 흐름 및 오케스트레이션 |
| [08-dashboard.md](./08-dashboard.md) | 웹 대시보드 상세 스펙 |
| [09-strategy.md](./09-strategy.md) | 투자 전략 시스템 |
| [10-ai-decision.md](./10-ai-decision.md) | AI 자율 투자 판단 시스템 |
| [11-telegram.md](./11-telegram.md) | 텔레그램 연동 |
