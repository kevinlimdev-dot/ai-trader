# 01 - 프로젝트 개요

## 1. 프로젝트 목적

**AI Trader**는 바이낸스 선물(Binance Futures) 가격 데이터를 실시간으로 수집하고, 하이퍼리퀴드(HyperLiquid) 거래소와의 가격 차이를 분석하여 방향성을 예측한 뒤, 하이퍼리퀴드에서 자동으로 매매하는 트레이딩 봇이다.

OpenClaw Gateway 위에서 구동되며, 스킬(Skill) 기반으로 데이터 수집, 분석, 거래, 자금 관리 기능을 모듈화한다. **SvelteKit 기반 웹 대시보드**를 통해 실시간 모니터링, 거래 제어, 지갑 관리가 가능하다. Telegram/Discord 알림도 지원한다.

### 핵심 전략

1. **바이낸스 선물 가격 > 하이퍼리퀴드 가격** → 하이퍼리퀴드 가격이 따라 올라갈 가능성 분석 → **롱(LONG)** 진입 검토
2. **바이낸스 선물 가격 < 하이퍼리퀴드 가격** → 하이퍼리퀴드 가격이 따라 내려갈 가능성 분석 → **숏(SHORT)** 진입 검토
3. 단순 스프레드 비교가 아닌, **기술적 분석 + 추세 분석**을 결합하여 방향성을 최종 확정한다

---

## 2. 시스템 아키텍처

### OpenClaw Gateway 기반 구조

OpenClaw는 로컬 머신에서 실행되는 **Gateway 데몬**이다. Gateway가 AI 모델(Claude 등)을 "두뇌"로 사용하고, 내장 도구(`exec`, `read`, `write`, `cron` 등)와 스킬(`SKILL.md`)을 통해 실제 작업을 수행한다.

```
┌─────────────────────────────────────────────────────────────────┐
│                     OpenClaw Gateway (데몬)                      │
│                                                                 │
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
│                                                                 │
│  ┌────────────┐  ┌────────────┐  ┌────────────────────┐       │
│  │ cron 스케줄 │  │ memory     │  │ 채널 (Telegram 등) │       │
│  └────────────┘  └────────────┘  └────────────────────┘       │
└───────────────────────┬─────────────────────────────────────────┘
                        │
       ┌────────────────┼────────────────┐
       ▼                ▼                ▼
 ┌───────────┐  ┌─────────────┐  ┌──────────────────┐
 │  Binance   │  │ HyperLiquid │  │ Coinbase Agentic │
 │  Futures   │  │  Exchange   │  │     Wallet       │
 └───────────┘  └─────────────┘  └──────────────────┘
```

### 핵심 개념

| 개념 | 설명 |
|------|------|
| **Gateway** | OpenClaw의 핵심 프로세스. Bun 런타임 위에서 실행되며 AI 모델, 채널, 도구를 관리 |
| **Skill** | `SKILL.md` 파일로 정의된 모듈. 에이전트에게 특정 작업 수행 방법을 가르침 |
| **Tool** | Gateway 내장 도구 (`exec`, `read`, `write`, `cron`, `web_fetch` 등) |
| **Channel** | 사용자와 에이전트 간 통신 수단 (Telegram, Discord, WebChat 등) |
| **Cron** | Gateway 내장 스케줄러. 주기적 트레이딩 루프 실행에 사용 |
| **Sub-Agent** | 백그라운드 작업 실행 (`sessions_spawn`). 병렬 처리에 활용 |
| **Memory** | 영속적 컨텍스트 저장소. 트레이딩 상태 기억 |

---

## 3. 스킬 구성 (5개)

각 스킬은 `skills/` 디렉토리 아래에 `SKILL.md`와 TypeScript 스크립트로 구성된다. OpenClaw 에이전트는 스킬의 지침에 따라 `exec` 도구로 스크립트를 실행한다.

| 스킬 | 디렉토리 | 역할 | 연동 서비스 |
|------|---------|------|-----------|
| **data-collector** | `skills/data-collector/` | 바이낸스 선물 + 하이퍼리퀴드 가격 수집 | Binance Futures, HyperLiquid Info API |
| **analyzer** | `skills/analyzer/` | 가격 차이 분석, 기술적 지표, 매매 시그널 생성 | 내부 데이터 |
| **ai-decision** | `skills/ai-decision/` | 시장 심리 수집 + AI 자율 투자 판단 + 시그널 필터링 | Binance Futures, HyperLiquid, OpenClaw AI |
| **trader** | `skills/trader/` | 하이퍼리퀴드 주문 실행, 포지션 관리 | HyperLiquid Exchange API |
| **wallet-manager** | `skills/wallet-manager/` | HyperLiquid 잔고 모니터링 + Coinbase Agentic Wallet 자금 리밸런싱 | HyperLiquid, Coinbase Agentic Wallet |

---

## 4. 기술 스택

### OpenClaw

- **OpenClaw Gateway** — AI 에이전트 프레임워크 (**Bun 런타임**)
  - 설치: `bun install -g openclaw@latest`
  - 셋업: `openclaw onboard --install-daemon`
  - 대시보드: `openclaw dashboard` → `http://127.0.0.1:18789`
  - AgentSkills 호환 스킬 시스템 (`SKILL.md`)
  - 내장 도구: `exec`, `read`, `write`, `cron`, `web_fetch`, `browser` 등
  - 채널: Telegram, Discord, WebChat 등

### 언어 및 런타임

- **Bun** — OpenClaw Gateway 런타임 + TypeScript 런타임 + 패키지 매니저 통합
  - OpenClaw 소스를 `bun install` / `bun run build`로 빌드·실행
  - 내장 SQLite (`bun:sqlite`)
- **TypeScript** — 트레이딩 로직 개발 언어

### 거래소 API

- **`@nktkas/hyperliquid`** — 하이퍼리퀴드 TypeScript SDK (100% TS, viem 호환)
- **Binance Futures REST API** — 바이낸스 선물 공개 REST API (경량 직접 호출)

### 지갑 / 입금

- **HyperLiquid 입금** — 사용자가 Arbitrum USDC를 HyperLiquid 입금 주소(`HYPERLIQUID_DEPOSIT_ADDRESS`)로 직접 입금
- **Coinbase Agentic Wallet** — AI 에이전트 전용 보조 지갑 (`awal` CLI, 이메일 OTP 인증, Base 네트워크, 가스비 무료). 자동 리밸런싱에 활용

### 데이터베이스

- **`bun:sqlite`** — Bun 내장 SQLite (거래 이력, 스냅샷 저장)

---

## 5. 실행 흐름 요약

### 5.1 트레이딩 파이프라인 (7단계 + 독립 모니터)

Runner (`src/runner.ts`) 또는 웹 대시보드의 **자동매매 시작** 버튼으로 실행한다. OpenClaw AI 에이전트가 4단계에서 자율적으로 투자 판단을 내린다:

```
[파이프라인 실행 — Runner 또는 OpenClaw 에이전트]

1. 가격 수집 (data-collector)
   └── bun run skills/data-collector/scripts/collect-prices.ts
       ├── 바이낸스 선물 가격 수집 (Rate Limiter 적용)
       ├── 하이퍼리퀴드 가격 수집 (Rate Limiter 적용)
       └── DB + data/snapshots/latest.json 저장

2. 기술적 분석 (analyzer)
   └── bun run skills/analyzer/scripts/analyze.ts
       ├── 스프레드 분석 + 기술적 지표 (전략 프리셋 적용)
       └── data/signals/latest.json 생성

3. 시장 심리 수집 (ai-decision)
   └── bun run skills/ai-decision/scripts/collect-sentiment.ts
       ├── 바이낸스: OI, 롱/숏 비율, 탑 트레이더 포지션, 테이커 매수/매도, 펀딩비
       ├── 하이퍼리퀴드: 펀딩비, OI, 프리미엄, 24시간 거래량
       └── data/sentiment/latest.json 저장

4. ★ AI 자율 투자 판단 (ai-decision) ★
   └── bun run skills/ai-decision/scripts/summarize.ts
       ├── 기술적 분석 + 시장 심리 + 현재 포지션 + 잔고 종합 요약
       └── OpenClaw AI가 데이터를 분석하여 독립적 투자 결정
   └── bun run skills/ai-decision/scripts/apply-decision.ts --decisions '<JSON>'
       ├── AI가 승인/거부한 종목에 대해 시그널 파일 수정
       └── 기술적 근거 + 심리적 근거를 reason에 기록

5. 자금 리밸런싱 (wallet-manager)
   └── bun run skills/wallet-manager/scripts/manage-wallet.ts --action auto-rebalance
       ├── Coinbase ↔ HyperLiquid 잔고 확인
       └── 잔고 부족 시 자동 충전

6. 거래 실행 (trader)
   └── bun run skills/trader/scripts/execute-trade.ts
       ├── AI가 승인한 시그널만 실행 (필터링 완료)
       ├── 하이퍼리퀴드 주문 실행
       └── SQLite 거래 로그 저장

7. 결과 보고
   └── AI 판단 근거(기술적/심리적), 승인/거부 종목, 시장 분위기 요약

[독립 프로세스 — Position Monitor]
   └── bun run src/position-monitor.ts
       ├── 15초 주기로 열린 포지션 SL/TP/트레일링 스탑 체크
       ├── 조건 충족 시 즉시 청산
       └── 포지션 없으면 5분 후 자동 종료
```

> **Note:** 포지션 모니터링은 파이프라인과 분리된 독립 프로세스로 실행된다. Runner가 거래 실행 후 자동으로 시작하며, 1회 실행(`--once`) 후에도 백그라운드에서 유지된다.

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

- **자동매매 시작/정지**: OpenClaw 에이전트 또는 직접 실행 모드
- **1회 실행 (Run Once)**: 파이프라인 1회 실행 + 포지션 모니터 자동 시작
- **포지션 모니터**: 독립 시작/정지 제어
- **Paper/Live 모드 전환**: 대시보드에서 즉시 전환
- **전략 선택**: Conservative / Balanced / Aggressive
- **Arbitrum → HL 입금**: 대시보드에서 원클릭 입금
- **Kill Switch**: 긴급 거래 중단

### 5.4 대화 기반 (Telegram)

Telegram 봇(`@aiiiiitrading_bot`)을 통해 OpenClaw 에이전트에게 자연어 명령을 내릴 수 있다. 대시보드 버튼과 동일한 기능을 제공한다:

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
| "최근 로그" / "logs" | 최근 Runner 로그 표시 |

---

## 6. 프로젝트 디렉토리 구조

```
ai-trader/
├── skills/                       # OpenClaw 스킬 (SKILL.md + 스크립트)
│   ├── data-collector/
│   │   ├── SKILL.md
│   │   └── scripts/
│   │       └── collect-prices.ts
│   ├── analyzer/
│   │   ├── SKILL.md
│   │   └── scripts/
│   │       └── analyze.ts
│   ├── ai-decision/              # AI 자율 투자 판단 스킬 (NEW)
│   │   └── scripts/
│   │       ├── collect-sentiment.ts  # 시장 심리 데이터 수집
│   │       ├── summarize.ts          # AI 판단용 종합 요약
│   │       └── apply-decision.ts     # AI 결정 적용 (시그널 필터링)
│   ├── trader/
│   │   ├── SKILL.md
│   │   └── scripts/
│   │       └── execute-trade.ts
│   └── wallet-manager/
│       ├── SKILL.md
│       └── scripts/
│           ├── manage-wallet.ts
│           ├── deposit-to-hl.ts     # Arbitrum → HL 자동 입금
│           └── spot-to-perp.ts      # Spot ↔ Perp 전송 (비통합 계정용)
├── src/                          # TypeScript 소스 코드
│   ├── runner.ts                 # 연속 트레이딩 러너 (7단계 오케스트레이터)
│   ├── position-monitor.ts       # 독립 포지션 모니터 (15초 주기)
│   ├── services/
│   │   ├── binance.service.ts    # 바이낸스 API + Rate Limiter + 시장 심리
│   │   ├── hyperliquid.service.ts # 하이퍼리퀴드 API (Unified Account 대응)
│   │   └── coinbase.service.ts   # awal CLI 래퍼
│   ├── strategies/
│   │   └── presets.ts            # 전략 프리셋 (Conservative/Balanced/Aggressive)
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
│       ├── openclaw.ts           # OpenClaw 바이너리 탐지 및 에이전트 실행
│       ├── rate-limiter.ts       # Token Bucket Rate Limiter
│       └── risk-manager.ts
├── dashboard/                    # 웹 대시보드 (SvelteKit) (NEW)
│   ├── src/
│   │   ├── lib/
│   │   │   ├── server/
│   │   │   │   ├── db.ts         # DB 접근, 지갑 주소, 설정 관리
│   │   │   │   └── bot.ts        # 봇 스크립트 실행 (Bun.spawn)
│   │   │   ├── components/       # Svelte 컴포넌트
│   │   │   │   ├── Sidebar.svelte
│   │   │   │   ├── KpiCard.svelte
│   │   │   │   ├── PriceChart.svelte
│   │   │   │   ├── TradesTable.svelte
│   │   │   │   ├── SignalBadge.svelte
│   │   │   │   └── SetupBanner.svelte
│   │   │   └── types.ts
│   │   └── routes/
│   │       ├── +page.svelte      # 메인 대시보드
│   │       ├── positions/        # 포지션 관리
│   │       ├── trades/           # 거래 내역
│   │       ├── signals/          # 시그널 분석
│   │       ├── wallet/           # 지갑 & 입금 주소
│   │       ├── control/          # 봇 제어
│   │       └── api/              # REST API 엔드포인트
│   │           ├── bot/          # 봇 제어 (runner, monitor, strategy, deposit 등)
│   │           ├── balances/     # 실시간 잔고
│   │           ├── prices/       # 실시간 가격
│   │           └── ...           # trades, signals, positions, coins 등
│   ├── package.json
│   └── svelte.config.js
├── data/                         # 런타임 데이터
│   ├── snapshots/
│   ├── signals/
│   ├── sentiment/                # 시장 심리 데이터 (NEW)
│   │   └── latest.json
│   └── ai-trader.db
├── AGENTS.md
├── config.yaml
├── .env
├── package.json
├── tsconfig.json
└── bunfig.toml
```

---

## 7. 기술 스택 요약 (추가)

### 웹 대시보드

| 항목 | 기술 |
|------|------|
| **프레임워크** | SvelteKit (Svelte 5 runes) |
| **스타일링** | Tailwind CSS v4 |
| **차트** | Lightweight Charts |
| **런타임** | Bun (vite dev/build 모두 Bun) |
| **API** | SvelteKit server routes (`+server.ts`) |
| **실시간** | 폴링 (3초/10초/60초 계층적 갱신) |

### 거래소 API 쿼터 관리

| 항목 | 설정 |
|------|------|
| **알고리즘** | Token Bucket |
| **바이낸스** | 28 req/s (IP당 40의 70% 안전 마진) |
| **하이퍼리퀴드** | 14 req/s (공식 20의 70% 안전 마진) |
| **429 대응** | Retry-After 헤더 존중 + 자동 대기 |

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
