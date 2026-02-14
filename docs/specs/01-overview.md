# 01 - 프로젝트 개요

## 1. 프로젝트 목적

**AI Trader**는 바이낸스 선물(Binance Futures) 가격 데이터를 실시간으로 수집하고, 하이퍼리퀴드(HyperLiquid) 거래소와의 가격 차이를 분석하여 방향성을 예측한 뒤, 하이퍼리퀴드에서 자동으로 매매하는 트레이딩 봇이다.

OpenClaw Gateway 위에서 구동되며, 스킬(Skill) 기반으로 데이터 수집, 분석, 거래, 자금 관리 기능을 모듈화한다. Telegram/Discord를 통해 실시간 모니터링과 제어가 가능하다.

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
| **wallet-manager** | `skills/wallet-manager/` | 코인베이스 Agentic Wallet 자금 관리 | Coinbase Agentic Wallet |

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
- **`@binance/derivatives-trading-usds-futures`** — 바이낸스 USDS-M 선물 공식 SDK

### 지갑 API

- **Coinbase Agentic Wallet** — AI 에이전트 전용 지갑 (REST API + `awal` CLI)

### 데이터베이스

- **`bun:sqlite`** — Bun 내장 SQLite (거래 이력, 스냅샷 저장)

---

## 5. 실행 흐름 요약

OpenClaw의 **cron** 기능으로 매초/매분 트레이딩 루프를 실행한다:

```
[Cron: 매 N초마다 isolated job 실행]

1. data-collector 스킬 호출
   └── bun run scripts/collect-prices.ts
       ├── 바이낸스 선물 가격 수집
       ├── 하이퍼리퀴드 가격 수집
       └── data/snapshots/latest.json 생성

2. analyzer 스킬 호출
   └── bun run scripts/analyze.ts
       ├── 스프레드 분석
       ├── 기술적 지표 계산
       └── data/signals/latest.json 생성

3. trader 스킬 호출
   └── bun run scripts/execute-trade.ts
       ├── 시그널 검증 + 리스크 체크
       ├── 하이퍼리퀴드 주문 실행
       └── SQLite 거래 로그 저장

4. wallet-manager 스킬 호출 (필요 시)
   └── bun run scripts/manage-wallet.ts
       ├── 잔고 모니터링
       └── 자금 이동 처리

[결과를 Telegram/Discord로 알림]
```

또는 Telegram에서 직접 명령:
- "현재 포지션 보여줘" → trader 스킬 호출
- "잔고 확인해줘" → wallet-manager 스킬 호출
- "거래 중지해" → KILL_SWITCH 생성

---

## 6. 프로젝트 디렉토리 구조

```
ai-trader/
├── skills/                       # OpenClaw 스킬 (SKILL.md + 스크립트)
│   ├── data-collector/
│   │   ├── SKILL.md              # 에이전트 지침
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
│   ├── services/                 # 외부 API 서비스 래퍼
│   │   ├── binance.service.ts
│   │   ├── hyperliquid.service.ts
│   │   └── coinbase.service.ts
│   ├── models/                   # 데이터 타입 정의
│   │   ├── price-snapshot.ts
│   │   ├── trade-signal.ts
│   │   └── order.ts
│   ├── db/                       # bun:sqlite
│   │   ├── schema.ts
│   │   └── repository.ts
│   └── utils/
│       ├── config.ts
│       ├── logger.ts
│       └── risk-manager.ts
├── data/                         # 런타임 데이터
│   ├── snapshots/
│   ├── signals/
│   └── ai-trader.db             # SQLite DB
├── AGENTS.md                     # OpenClaw 에이전트 페르소나/규칙
├── config.yaml                   # 트레이딩 설정
├── .env                          # API 키 (gitignore)
├── package.json
├── tsconfig.json
└── bunfig.toml
```

---

## 7. 문서 네비게이션

| 문서 | 내용 |
|------|------|
| [01-overview.md](./01-overview.md) | 프로젝트 개요 (현재 문서) |
| [02-data-agent.md](./02-data-agent.md) | 데이터 수집 스킬 상세 스펙 |
| [03-analysis-agent.md](./03-analysis-agent.md) | 분석 스킬 상세 스펙 |
| [04-trade-agent.md](./04-trade-agent.md) | 거래 실행 스킬 상세 스펙 |
| [05-wallet-agent.md](./05-wallet-agent.md) | 지갑 관리 스킬 상세 스펙 |
| [06-config-and-deployment.md](./06-config-and-deployment.md) | OpenClaw 설정 및 배포 |
| [07-data-flow.md](./07-data-flow.md) | 데이터 흐름 및 오케스트레이션 |
