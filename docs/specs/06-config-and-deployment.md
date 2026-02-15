# 06 - OpenClaw 설정 및 배포

## 1. 개요

이 문서는 OpenClaw Gateway 설정, AGENTS.md 구성, 크론 스케줄링, 환경 변수 관리, 프로젝트 설정 전체를 기술한다.

---

## 2. OpenClaw 설치 및 초기 설정

### 2.1 Bun 설치

```bash
# Bun 설치
curl -fsSL https://bun.sh/install | bash
bun --version
```

### 2.2 OpenClaw 설치 (Bun 런타임)

OpenClaw를 Bun으로 설치하고 실행한다.

```bash
# OpenClaw 글로벌 설치
bun install -g openclaw@latest

# 온보딩 위저드 (인증, 채널 설정)
openclaw onboard --install-daemon

# Gateway 상태 확인
openclaw gateway status

# 대시보드 열기
openclaw dashboard
```

> **참고**: OpenClaw의 Bun 지원은 experimental이다. WhatsApp/Telegram 채널에서 일부 이슈가 있을 수 있으나, 트레이딩 봇 용도(WebChat/Discord)로는 정상 동작한다. 의존성 lifecycle 스크립트가 차단되면 `bun pm trust @whiskeysockets/baileys protobufjs`로 신뢰 등록한다.

---

## 3. openclaw.json 설정

OpenClaw의 모든 설정은 `~/.openclaw/openclaw.json`에 위치한다.

```json5
{
  // AI 모델 설정
  agents: {
    defaults: {
      model: { primary: "anthropic/claude-sonnet-4" },
      // 서브에이전트 (백그라운드 작업)
      subagents: {
        model: "anthropic/claude-sonnet-4",
        maxConcurrent: 4,
        archiveAfterMinutes: 60,
      },
    },
    list: [
      {
        id: "main",
        default: true,
        name: "AI Trader",
        workspace: "~/Documents/GitHub/ai-trader",
      },
    ],
  },

  // 도구 설정
  tools: {
    profile: "coding",
    web: {
      search: { enabled: true },
      fetch: { enabled: true },
    },
  },

  // 스킬 설정
  skills: {
    install: {
      nodeManager: "bun",    // 스킬 설치 시 bun 사용
    },
    load: {
      watch: true,           // SKILL.md 변경 자동 감지
      watchDebounceMs: 250,
    },
    entries: {
      "data-collector": {
        enabled: true,
        env: {
          BINANCE_API_KEY: "BINANCE_KEY_HERE",
          BINANCE_API_SECRET: "BINANCE_SECRET_HERE",
        },
      },
      "analyzer": {
        enabled: true,
      },
      "trader": {
        enabled: true,
        env: {
          HYPERLIQUID_PRIVATE_KEY: "0x...",
        },
      },
      "wallet-manager": {
        enabled: true,
        // Agentic Wallet은 awal CLI 인증 사용 — env 설정 불필요
      },
    },
  },

  // 크론 설정
  cron: {
    enabled: true,
    maxConcurrentRuns: 1,
  },

  // 채널 설정 (Telegram 예시)
  channels: {
    telegram: {
      enabled: true,
    },
  },

  // 브라우저 비활성화 (불필요)
  browser: {
    enabled: false,
  },
}
```

---

## 4. AGENTS.md (에이전트 페르소나)

프로젝트 루트의 `AGENTS.md`는 OpenClaw 에이전트의 행동 규칙과 페르소나를 정의한다.

```markdown
# AI Trader Agent

## 역할
나는 암호화폐 자동 거래 봇이다. 바이낸스 선물과 하이퍼리퀴드의 가격 차이를 분석하여
매매 시그널을 생성하고 자동으로 거래를 실행한다.

## 핵심 규칙
1. 안전 최우선: KILL_SWITCH 파일 존재 시 즉시 모든 거래 중단
2. 리스크 관리: 거래당 잔고의 2% 이내 리스크
3. 보수적 진입: 복합 점수 0.5 이상에서만 진입
4. 정직한 보고: 수익/손실을 있는 그대로 보고

## 트레이딩 루프 순서
1. data-collector → 2. analyzer → 3. trader → (4. wallet-manager, 필요 시)

## 통신 규칙
- 한국어로 응답
- 거래 실행 시 항목: 심볼, 방향, 진입가, 수량, 손절/익절
- 에러 발생 시 즉시 알림
- 일일 요약 리포트 저녁 10시
```

---

## 5. 크론 설정 (자동 트레이딩 루프)

OpenClaw cron으로 주기적 트레이딩 루프를 실행한다.

### 5.1 트레이딩 루프 (매 30초)

```bash
openclaw cron add \
  --name "Trading Loop" \
  --cron "*/30 * * * * *" \
  --session isolated \
  --message "트레이딩 루프 실행: 1) data-collector 스킬로 가격 수집 2) analyzer 스킬로 분석 3) 시그널이 LONG/SHORT이면 trader 스킬로 주문 실행. 결과 요약해줘." \
  --announce \
  --channel telegram
```

### 5.2 포지션 모니터링 (매 10초)

```bash
openclaw cron add \
  --name "Position Monitor" \
  --cron "*/10 * * * * *" \
  --session isolated \
  --message "trader 스킬로 열린 포지션 확인. 트레일링 스탑/손절/익절 조건 체크." \
  --model "anthropic/claude-sonnet-4"
```

### 5.3 일일 리포트 (매일 22:00)

```bash
openclaw cron add \
  --name "Daily Report" \
  --cron "0 22 * * *" \
  --tz "Asia/Seoul" \
  --session isolated \
  --message "오늘의 트레이딩 일일 리포트 생성: 총 거래수, 승률, 총 PnL, 최대 이익/손실, 잔고 현황. trader 스킬의 daily-summary와 wallet-manager의 daily-report를 사용해." \
  --announce \
  --channel telegram
```

### 5.4 잔고 체크 (매 5분)

```bash
openclaw cron add \
  --name "Balance Check" \
  --cron "*/5 * * * *" \
  --session isolated \
  --message "wallet-manager 스킬로 잔고 확인. 하이퍼리퀴드 잔고가 낮으면 자동 충전 여부 판단."
```

---

## 6. 환경 변수 (.env)

프로젝트 루트 `.env`에 시크릿 저장. `openclaw.json`의 `skills.entries.*.env`에서도 설정 가능하지만, `.env`로 통합 관리하는 것을 권장.

```bash
# 바이낸스 선물 (가격 조회용 — 공개 API만 사용 시 없어도 됨)
BINANCE_API_KEY=your_binance_api_key
BINANCE_API_SECRET=your_binance_api_secret

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

## 7. config.yaml (트레이딩 설정)

트레이딩 파라미터는 `config.yaml`에 정의. OpenClaw 설정(`openclaw.json`)과 분리하여 관리한다.
대시보드에서 `paper`/`live` 모드를 전환하면 이 파일의 `general.mode`가 자동으로 업데이트된다.

```yaml
general:
  mode: "paper"                    # paper / live (대시보드에서 전환 가능)
  log_level: "info"
  timezone: "Asia/Seoul"

data_agent:
  symbols:
    - symbol: "BTC"
      binance_pair: "BTCUSDT"
      hyperliquid_pair: "BTC"
    - symbol: "ETH"
      binance_pair: "ETHUSDT"
      hyperliquid_pair: "ETH"
  polling_interval_ms: 1000
  candle_interval: "1m"
  candle_lookback: 100
  binance:
    base_url: "https://fapi.binance.com"
    reconnect_delay_ms: 5000
    max_reconnect_attempts: 10
  hyperliquid:
    base_url: "https://api.hyperliquid.xyz"
    request_timeout_ms: 5000
  anomaly_threshold_pct: 0.10
  storage:
    max_snapshots_per_symbol: 3600
    cleanup_interval_min: 30

analysis_agent:
  spread:
    threshold_high: 0.05
    threshold_extreme: 0.15
    lookback_count: 60
  indicators:
    rsi: { period: 14, overbought: 70, oversold: 30 }
    macd: { fast: 12, slow: 26, signal: 9 }
    bollinger: { period: 20, std_dev: 2.0 }
    ma: { short: 7, medium: 25, long: 99 }
  weights:
    spread: 0.30
    rsi: 0.15
    macd: 0.20
    bollinger: 0.15
    ma: 0.20
  signal:
    entry_threshold: 0.5
    min_confidence: 0.4
    cooldown_seconds: 30
  risk:
    atr_period: 14
    stop_loss_multiplier: 2.0
    take_profit_multiplier: 3.0
    min_risk_reward_ratio: 1.5

trade_agent:
  hyperliquid:
    base_url: "https://api.hyperliquid.xyz"
    slippage: 0.01
  leverage: { default: 5, max: 10 }
  risk:
    risk_per_trade: 0.02
    max_position_pct: 0.10
    max_daily_loss: 0.05
    max_concurrent_positions: 3
    max_daily_trades: 50
    min_balance_usdc: 100
    min_signal_confidence: 0.4
  trailing_stop:
    enabled: true
    activation_pct: 1.5
    trail_pct: 0.8
  safety:
    kill_switch_file: "data/KILL_SWITCH"
    max_consecutive_api_errors: 5
    price_anomaly_threshold: 5.0
  paper_fee_rate: 0.0005             # Paper 모드 수수료율
  signal_max_age_seconds: 60         # 시그널 유효 기간

wallet_agent:
  monitoring:
    balance_check_interval_sec: 30
    low_balance_alert_usdc: 300
  agentic_wallet:
    network: "base"
    cli_timeout_ms: 30000
  transfers:
    max_single_transfer: 1000
    max_daily_transfer: 5000
    auto_fund_enabled: true
    auto_fund_buffer_pct: 0.20
    auto_withdraw_excess_pct: 0.50   # HL 초과분 회수 비율 (NEW)
  security:
    min_reserve_coinbase: 500
    min_reserve_hyperliquid: 200
    max_reserve_hyperliquid: 3000    # HL 최대 보유 한도 (NEW)
    whitelist: []

database:
  path: "data/ai-trader.db"
  wal_mode: true
```

---

## 8. package.json

```json
{
  "name": "ai-trader",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "collect": "bun run skills/data-collector/scripts/collect-prices.ts",
    "analyze": "bun run skills/analyzer/scripts/analyze.ts",
    "trade": "bun run skills/trader/scripts/execute-trade.ts",
    "wallet": "bun run skills/wallet-manager/scripts/manage-wallet.ts",
    "monitor": "bun run skills/trader/scripts/execute-trade.ts --action monitor",
    "setup-db": "bun run src/db/schema.ts",
    "typecheck": "tsc --noEmit",
    "dashboard": "cd dashboard && bun run dev",
    "dashboard:build": "cd dashboard && bun run build",
    "dashboard:preview": "cd dashboard && bun run preview"
  },
  "dependencies": {
    "@nktkas/hyperliquid": "^0.31.0",
    "yaml": "^2.8.2",
    "technicalindicators": "^3.1.0"
  },
  "devDependencies": {
    "@types/bun": "^1.3.9",
    "@types/node": "^25.2.3",
    "typescript": "^5.9.3",
    "viem": "^2.45.3"
  }
}
```

---

## 9. tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["bun-types"],
    "strict": true,
    "esModuleInterop": true,
    "outDir": "dist",
    "rootDir": ".",
    "resolveJsonModule": true,
    "declaration": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*.ts", "skills/**/*.ts"]
}
```

---

## 10. 배포

### 로컬 실행

```bash
# 1. 의존성 설치
bun install
cd dashboard && bun install && cd ..

# 2. DB 초기화
bun run setup-db

# 3. Agentic Wallet 인증 (최초 1회)
bunx awal auth login your@email.com
bunx awal auth verify <flowId> <code>
bunx awal status  # 인증 확인

# 4. 웹 대시보드 실행 (SvelteKit)
bun run dashboard
# → http://localhost:5173 에서 모니터링/제어

# 5. OpenClaw Gateway 실행 (별도 터미널 또는 데몬)
openclaw gateway

# 6. 크론 작업 등록 (최초 1회, 자동 트레이딩 루프용)
# → 위 섹션 5의 cron add 명령 실행
# 또는 대시보드의 "Run All" 버튼으로 수동 실행
```

### pm2 (Gateway가 이미 데몬이므로, Gateway 자체는 pm2 불필요)

Gateway는 `openclaw onboard --install-daemon`으로 시스템 서비스로 등록된다 (macOS: launchd, Linux: systemd). 추가 pm2 래퍼는 불필요.

### 상태 확인

```bash
openclaw gateway status
openclaw cron list
openclaw health
```

---

## 11. .gitignore

```
node_modules/
dist/
data/*.db
data/*.db-journal
data/*.db-wal
data/snapshots/
data/signals/
data/KILL_SWITCH
.env
.env.*
*.log
bun.lockb
```

---

## 관련 문서

- [01-overview.md](./01-overview.md) — 아키텍처 개요
- [07-data-flow.md](./07-data-flow.md) — 데이터 흐름 / 오케스트레이션
- [08-dashboard.md](./08-dashboard.md) — 웹 대시보드 상세 스펙
