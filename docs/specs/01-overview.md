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

## 3. 스킬 구성 (4개)

각 스킬은 `skills/` 디렉토리 아래에 `SKILL.md`와 TypeScript 스크립트로 구성된다. OpenClaw 에이전트는 스킬의 지침에 따라 `exec` 도구로 스크립트를 실행한다.

| 스킬 | 디렉토리 | 역할 | 연동 서비스 |
|------|---------|------|-----------|
| **data-collector** | `skills/data-collector/` | 바이낸스 선물 + 하이퍼리퀴드 가격 수집 | Binance Futures, HyperLiquid Info API |
| **analyzer** | `skills/analyzer/` | 가격 차이 분석, 기술적 지표, 매매 시그널 생성 | 내부 데이터 |
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

### 5.1 트레이딩 파이프라인 (5단계)

OpenClaw cron 또는 웹 대시보드의 **Run All** 버튼으로 실행한다:

```
[파이프라인 실행]

1. 가격 수집 (data-collector)
   └── bun run scripts/collect-prices.ts
       ├── 바이낸스 선물 가격 수집 (Rate Limiter 적용)
       ├── 하이퍼리퀴드 가격 수집 (Rate Limiter 적용)
       └── DB + data/snapshots/latest.json 저장

2. 시그널 분석 (analyzer)
   └── bun run scripts/analyze.ts
       ├── 스프레드 분석 + 기술적 지표
       └── data/signals/latest.json 생성

3. 자금 리밸런싱 (wallet-manager) ← NEW
   └── bun run scripts/manage-wallet.ts --action auto-rebalance
       ├── Coinbase ↔ HyperLiquid 잔고 확인
       ├── HL 부족 시 Coinbase에서 자동 충전
       └── HL 과다 시 Coinbase로 자동 회수

4. 거래 실행 (trader)
   └── bun run scripts/execute-trade.ts
       ├── 시그널 검증 + 리스크 체크
       ├── 하이퍼리퀴드 주문 실행
       └── SQLite 거래 로그 저장

5. 포지션 모니터링 (trader)
   └── bun run scripts/execute-trade.ts --action monitor
       ├── SL/TP/트레일링 스탑 체크
       └── 조건 충족 시 자동 청산
```

### 5.2 웹 대시보드 제어

- **Run All**: 위 5단계를 순차 실행, 진행 상황 실시간 표시
- **개별 실행**: 각 단계를 독립적으로 실행 가능
- **Paper/Live 모드 전환**: 대시보드에서 즉시 전환
- **Kill Switch**: 긴급 거래 중단

### 5.3 대화 기반 (Telegram/Discord)

- "현재 포지션 보여줘" → trader 스킬 호출
- "잔고 확인해줘" → wallet-manager 스킬 호출
- "거래 중지해" → KILL_SWITCH 생성

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
│   ├── trader/
│   │   ├── SKILL.md
│   │   └── scripts/
│   │       └── execute-trade.ts
│   └── wallet-manager/
│       ├── SKILL.md
│       └── scripts/
│           └── manage-wallet.ts
├── src/                          # TypeScript 소스 코드
│   ├── services/
│   │   ├── binance.service.ts    # 바이낸스 API + Rate Limiter
│   │   ├── hyperliquid.service.ts # 하이퍼리퀴드 API + Rate Limiter
│   │   └── coinbase.service.ts   # awal CLI 래퍼
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
│       ├── rate-limiter.ts       # Token Bucket Rate Limiter (NEW)
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
│   ├── package.json
│   └── svelte.config.js
├── data/                         # 런타임 데이터
│   ├── snapshots/
│   ├── signals/
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
