# 06 - OpenClaw 설정 및 배포

## 1. 개요

이 문서는 OpenClaw Gateway 설정, 스킬 등록, 크론 스케줄링, SvelteKit 대시보드 연동을 기술한다.

**현재 구성:**
- OpenClaw Gateway — LaunchAgent 데몬으로 상시 실행 (모델: `gpt-5.1-codex`)
- SvelteKit 대시보드 — 웹 UI로 실시간 모니터링 및 거래 제어
- OpenClaw CLI — 터미널/텔레그램에서 투자 현황 조회
- OpenClaw Cron — 파이프라인 주기 실행 + 일일 리포트

---

## 2. 설치 및 초기 설정

### 2.1 Bun 설치

```bash
curl -fsSL https://bun.sh/install | bash
bun --version
```

### 2.2 OpenClaw 설치

```bash
bun install -g openclaw@latest
openclaw onboard --install-daemon
openclaw status
```

### 2.3 프로젝트 의존성

```bash
cd ~/Documents/GitHub/ai-trader
bun install
cd dashboard && bun install && cd ..
bun run setup-db
```

---

## 3. OpenClaw 스킬

### 3.1 ai-trader 스킬

스킬 파일: `~/.openclaw/workspace/skills/ai-trader/SKILL.md`

이 스킬은 OpenClaw 에이전트에게 다음 기능을 가르친다:
- 투자 현황 조회 (포지션, 잔고, 일일 요약)
- 트레이딩 파이프라인 실행 (7단계 — AI 자율 판단 포함)
- 시장 심리 데이터 수집 및 분석
- AI 자율 투자 판단 (기술적 분석 + 심리 분석 합류)
- 전략 관리 (conservative/balanced/aggressive)
- 안전 관리 (긴급 청산, Kill Switch)
- 연속 실행 (Runner) 제어
- 텔레그램 명령 처리 (대시보드 버튼과 동일)

스킬 상태 확인:

```bash
openclaw skills list        # 활성 스킬 목록
openclaw skills info ai-trader  # ai-trader 스킬 상세
```

### 3.2 스킬 구조

```
~/.openclaw/workspace/skills/ai-trader/
└── SKILL.md       # 에이전트 지침 (exec 명령, 텔레그램 명령 매핑, 7단계 파이프라인)

~/Documents/GitHub/ai-trader/skills/
├── data-collector/    # 가격 수집 스크립트
│   ├── SKILL.md
│   └── scripts/collect-prices.ts
├── analyzer/          # 시그널 분석 스크립트
│   ├── SKILL.md
│   └── scripts/analyze.ts
├── ai-decision/       # AI 자율 투자 판단 (NEW)
│   └── scripts/
│       ├── collect-sentiment.ts   # 시장 심리 수집
│       ├── summarize.ts           # AI 판단용 종합 요약
│       └── apply-decision.ts      # AI 결정 적용
├── trader/            # 거래 실행 스크립트
│   ├── SKILL.md
│   └── scripts/execute-trade.ts
└── wallet-manager/    # 자금 관리 스크립트
    ├── SKILL.md
    └── scripts/manage-wallet.ts
```

---

## 4. 크론 설정 (자동 트레이딩)

### 4.1 트레이딩 파이프라인 (5분 간격)

```bash
openclaw cron add \
  --name "ai-trader-pipeline" \
  --every "5m" \
  --message "AI Trader 트레이딩 파이프라인을 실행해줘. ai-trader 스킬의 파이프라인 7단계(가격수집→기술분석→심리수집→AI판단→리밸런싱→거래→결과보고)를 순서대로 실행하고 결과를 간단히 요약해줘." \
  --description "AI Trader 자동매매 파이프라인 (5분 간격)" \
  --session isolated \
  --timeout-seconds 300 \
  --thinking medium \
  --tz "Asia/Seoul" \
  --disabled
```

### 4.2 일일 리포트 (매일 22:00)

```bash
openclaw cron add \
  --name "ai-trader-daily-report" \
  --cron "0 22 * * *" \
  --message "AI Trader 오늘의 투자 일일 요약을 보여줘. ai-trader 스킬의 일일 요약 명령을 실행하고, 오늘 거래 횟수, 승률, 총 PnL, 잔고 변화를 텔레그램으로 보고해줘." \
  --description "AI Trader 일일 리포트 (매일 22시)" \
  --session isolated \
  --timeout-seconds 120 \
  --thinking low \
  --tz "Asia/Seoul" \
  --announce \
  --disabled
```

### 4.3 크론 관리

```bash
openclaw cron list --all     # 전체 작업 보기 (비활성 포함)
openclaw cron enable <id>    # 활성화
openclaw cron disable <id>   # 비활성화
openclaw cron run <id>       # 수동 실행 (테스트용)
openclaw cron rm <id>        # 삭제
```

---

## 5. OpenClaw CLI 사용법

### 5.1 투자 현황 조회

```bash
openclaw agent --agent main -m "AI Trader 투자 현황 알려줘"
```

에이전트가 ai-trader 스킬을 참고하여:
1. 포지션 조회 스크립트 실행
2. 잔고 확인
3. 일일 요약 제공
4. 한국어로 결과 요약

### 5.2 거래 실행

```bash
openclaw agent --agent main -m "AI Trader 파이프라인 한 번 실행해줘"
```

### 5.3 긴급 청산

```bash
openclaw agent --agent main -m "AI Trader 모든 포지션 긴급 청산해줘"
```

### 5.4 전략 변경

```bash
openclaw agent --agent main -m "AI Trader 전략을 aggressive로 변경해줘"
```

---

## 6. Heartbeat 설정

`~/.openclaw/workspace/HEARTBEAT.md`에 트레이딩 상태 자동 체크 및 텔레그램 알림 로직 추가:

```markdown
## AI Trader 체크
1. Kill Switch 확인 — 존재하면 즉시 텔레그램으로 알림
2. Runner 상태 — 에러 상태 또는 예기치 않은 중지 시 텔레그램 알림
3. 큰 손실 감지 — 일일 손실 10% 이상이면 텔레그램 경고
4. 포지션 모니터 상태 — 예기치 않게 중지되면 텔레그램 알림

## 텔레그램 알림 규칙
- 이상 없으면 silence (알림 안 보냄)
- 동일 이슈 반복 알림 금지
- 심야 시간(00:00~07:00 KST) 긴급 알림만
```

에이전트가 하트비트(~30분 간격) 시 자동으로 트레이딩 상태를 체크하고 이상 시 텔레그램으로 알린다.

---

## 7. 텔레그램 연동

### 7.1 OpenClaw 텔레그램 설정

```bash
# 텔레그램 채널 활성화
openclaw config set channels.telegram.enabled true
openclaw config set channels.telegram.dmPolicy pairing
openclaw config set channels.telegram.streamMode block

# 데몬 재시작
openclaw daemon restart

# 텔레그램 DM 페어링
openclaw pairing approve telegram
```

### 7.2 주요 설정 값

| 설정 | 값 | 설명 |
|------|-----|------|
| `channels.telegram.enabled` | `true` | 텔레그램 채널 활성화 |
| `channels.telegram.dmPolicy` | `pairing` | 페어링된 사용자만 DM 가능 |
| `channels.telegram.streamMode` | `block` | 완성 후 한번에 전달 (안정적) |

### 7.3 명령어 매핑

텔레그램에서 자연어로 명령하면 `ai-trader` 스킬의 지침에 따라 적절한 스크립트가 실행된다. 상세 명령어 목록은 [11-telegram.md](./11-telegram.md) 참조.

---

## 8. 환경 변수 (.env)

프로젝트 루트 `.env`에 시크릿 저장:

```bash
# 하이퍼리퀴드
HYPERLIQUID_PRIVATE_KEY=0xyour_private_key
HYPERLIQUID_DEPOSIT_ADDRESS=0xyour_deposit_address

# 코인베이스 Agentic Wallet
# API 키 불필요 — awal CLI로 이메일 OTP 인증
# 사전 설정: bunx awal auth login your@email.com → bunx awal auth verify <flowId> <code>

# 데이터베이스
DATABASE_PATH=data/ai-trader.db
```

---

## 9. config.yaml (트레이딩 설정)

트레이딩 파라미터는 `config.yaml`에 정의. 대시보드에서 mode, strategy를 전환하면 이 파일이 자동 업데이트된다.

주요 필드:

```yaml
general:
  mode: "live"                     # paper / live
  strategy: "aggressive"           # conservative / balanced / aggressive
  log_level: "info"
  timezone: "Asia/Seoul"

runner:
  interval_sec: 300                # 자동매매 간격 (초)
  max_cycles: 0                    # 0 = 무제한
  pause_between_steps_sec: 2
  cooldown_on_error_sec: 60
  max_consecutive_errors: 10
```

전체 설정은 `config.yaml` 파일 참조.

---

## 10. 배포 (실행 방법)

### 10.1 전체 시스템 시작

```bash
# 1. OpenClaw Gateway (이미 데몬으로 실행 중)
openclaw status

# 2. SvelteKit 대시보드 + awal sidecar
cd ~/Documents/GitHub/ai-trader
bun run dashboard
# → http://localhost:5173

# 3. 자동매매 시작 (아래 중 택1)
# 방법 A: 대시보드 "자동매매 시작" 버튼
# 방법 B: Runner 직접 실행
bun run runner              # 연속 실행
bun run runner:once         # 1회 실행 (포지션 모니터는 백그라운드 유지)

# 4. 포지션 모니터 (별도 실행 가능)
bun run monitor             # 15초 주기 SL/TP/트레일링 체크
bun run monitor:once        # 1회 체크

# 5. 입금 (Arbitrum USDC → HyperLiquid)
bun run deposit             # 전액 입금
bun run deposit -- --dry-run  # 시뮬레이션
```

### 10.2 상태 확인

```bash
openclaw status              # Gateway 상태
openclaw agent --agent main -m "투자 현황"   # 에이전트에게 물어보기

# 프로세스 상태 파일
cat /tmp/ai-trader-runner-status.json   # Runner 상태
cat /tmp/ai-trader-monitor-status.json  # Position Monitor 상태
```

---

## 11. 아키텍처 요약

```
                     ┌──────────────────────────────────┐
                     │     OpenClaw Gateway (데몬)        │
                     │     gpt-5.1-codex                  │
                     │                                    │
                     │  skills/ai-trader/SKILL.md         │
                     │  cron: pipeline + report            │
                     │  channels: Telegram (block mode)    │
                     │  HEARTBEAT: 자동 상태 체크           │
                     └──────┬─────────┬───────────────────┘
                            │         │
              ┌─────────────┘         └──────────────┐
              ▼                                      ▼
     ┌─────────────┐                      ┌──────────────────┐
     │ OpenClaw CLI │                      │ Telegram Channel │
     │ (터미널 조회) │                      │ @aiiiiitrading_bot│
     └──────┬──────┘                      │ (명령/알림/리포트)│
            │ exec                         └──────────────────┘
            ▼
┌───────────────────────────────────────────────────────────────┐
│                   AI Trader 프로젝트                           │
│                                                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ data-    │  │ analyzer │  │ trader   │  │ wallet-      │  │
│  │ collector│  │          │  │          │  │ manager      │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────┘  │
│                                                               │
│  ┌──────────────────────────┐                                │
│  │ ai-decision (NEW)         │                                │
│  │ → 시장 심리 수집           │                                │
│  │ → AI 자율 투자 판단        │                                │
│  │ → 시그널 필터링            │                                │
│  └──────────────────────────┘                                │
│                                                               │
│  ┌──────────────────┐  ┌────────────────────┐                │
│  │ src/runner.ts     │  │ src/position-      │                │
│  │ (7단계 파이프라인) │  │ monitor.ts         │                │
│  │ → 수집→분석→심리  │  │ (15초 SL/TP 체크)  │                │
│  │   →AI판단→리밸런  │  │ → 독립 프로세스     │                │
│  │   싱→거래→보고    │  │                    │                │
│  └──────────────────┘  └────────────────────┘                │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ dashboard/ (SvelteKit) — http://localhost:5173          │ │
│  │ 웹 UI 모니터링 + 제어 + 자동입금 + 포지션 모니터       │ │
│  │ HL 실시간 포지션 동기화 + AI 판단 근거 표시            │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  config.yaml ← 전략(strategy), 모드(mode) 설정               │
│  data/ai-trader.db ← SQLite (거래 이력, 스냅샷)              │
│  data/sentiment/latest.json ← 시장 심리 데이터               │
└───────────────────────────────────────────────────────────────┘
```

---

## 관련 문서

- [01-overview.md](./01-overview.md) — 아키텍처 개요
- [07-data-flow.md](./07-data-flow.md) — 데이터 흐름 / 오케스트레이션
- [08-dashboard.md](./08-dashboard.md) — 웹 대시보드 상세 스펙
- [09-strategy.md](./09-strategy.md) — 투자 전략 시스템
- [10-ai-decision.md](./10-ai-decision.md) — AI 자율 투자 판단 시스템
- [11-telegram.md](./11-telegram.md) — 텔레그램 연동
