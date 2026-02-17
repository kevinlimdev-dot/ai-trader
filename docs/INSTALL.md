# AI Trader 설치 가이드

HyperLiquid 자동 거래봇 설치 및 설정 방법.

---

## 목차

1. [사전 요구사항](#1-사전-요구사항)
2. [프로젝트 설치](#2-프로젝트-설치)
3. [환경 변수 설정](#3-환경-변수-설정)
4. [HyperLiquid 설정](#4-hyperliquid-설정)
5. [OpenClaw 설정](#5-openclaw-설정)
6. [데이터베이스 초기화](#6-데이터베이스-초기화)
7. [대시보드 설치](#7-대시보드-설치)
8. [실행 확인](#8-실행-확인)
9. [자동매매 시작](#9-자동매매-시작)
10. [문제 해결](#10-문제-해결)

---

## 1. 사전 요구사항

### 필수

| 항목 | 버전 | 설치 |
|------|------|------|
| **Bun** | 1.2+ | `curl -fsSL https://bun.sh/install \| bash` |
| **Node.js** | 20+ | Bun과 함께 설치됨 (일부 도구용) |
| **OpenClaw** | 2026.2+ | `bun add -g openclaw` |

### 거래소 계정

| 항목 | 용도 | 필수 여부 |
|------|------|----------|
| **HyperLiquid** | 거래 실행 | 필수 |
| **Coinbase** | Agentic Wallet (자금 리밸런싱) | 선택 |

### MetaMask 지갑 설치

HyperLiquid에 접속하려면 MetaMask 지갑이 필요합니다.

1. **MetaMask 설치**
   - Chrome: [Chrome Web Store](https://chromewebstore.google.com/detail/metamask/nkbihfbeogaeaoehlefnkodbefgpgknn) 에서 설치
   - Firefox: [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/ether-metamask/) 에서 설치
   - 모바일: App Store / Google Play에서 "MetaMask" 검색

2. **지갑 생성**
   - MetaMask 확장 프로그램 클릭 → "새 지갑 만들기"
   - 비밀번호 설정
   - **시드 구문(Secret Recovery Phrase) 12단어를 안전하게 백업** (종이에 적어 오프라인 보관 권장)
   - 시드 구문 확인 완료

3. **Arbitrum 네트워크 추가**
   - MetaMask → 네트워크 선택 (상단 드롭다운) → "네트워크 추가"
   - "Arbitrum One" 검색 → 추가
   - 또는 수동 입력:

   | 항목 | 값 |
   |------|------|
   | 네트워크 이름 | Arbitrum One |
   | RPC URL | `https://arb1.arbitrum.io/rpc` |
   | 체인 ID | 42161 |
   | 통화 기호 | ETH |
   | 블록 탐색기 | `https://arbiscan.io` |

4. **USDC 입금**
   - 거래소(업비트, 빗썸, 바이낸스 등)에서 **Arbitrum 네트워크**로 USDC를 MetaMask 주소로 전송
   - 또는 이더리움 메인넷에서 [Arbitrum Bridge](https://bridge.arbitrum.io/)를 통해 브릿지
   - **가스비용으로 소량의 ETH도 필요** (Arbitrum 가스비는 약 $0.01~0.10)

> **주의:** 반드시 **Arbitrum 네트워크**를 선택하여 전송하세요. 다른 네트워크로 보내면 자금을 잃을 수 있습니다.

### HyperLiquid 지갑 연결 및 설정

1. **HyperLiquid 접속 및 지갑 연결**
   - [HyperLiquid](https://app.hyperliquid.xyz/) 접속
   - 우측 상단 "Connect" 클릭 → MetaMask 선택
   - MetaMask 팝업에서 "연결" 승인
   - 서명 요청 승인 (가스비 없음)

2. **USDC 입금 (Arbitrum → HyperLiquid)**
   - HyperLiquid 앱 → Portfolio → "Deposit" 클릭
   - MetaMask에서 USDC 전송 승인
   - ~1분 내 HyperLiquid 잔고에 반영
   - 최소 **$100** 권장 (거래 + 마진용)

3. **API Wallet 생성 (봇 전용)**
   - Settings → API → "Generate API Wallet" 클릭
   - **API Wallet Name** 입력 (예: `ai-trader`)
   - MetaMask 서명 승인
   - 생성된 **Private Key**를 안전하게 복사하여 저장
   - 이 Private Key를 `.env` 파일의 `HYPERLIQUID_PRIVATE_KEY`에 입력

4. **입금 주소 확인**
   - Portfolio → Deposit 화면에서 Arbitrum 입금 주소 확인
   - 이 주소를 `.env` 파일의 `HYPERLIQUID_DEPOSIT_ADDRESS`에 입력

> **API Wallet vs 메인 지갑:** API Wallet은 거래 전용 지갑으로, 메인 지갑의 자금을 사용하지만 별도의 키로 작동합니다. API Wallet의 Private Key가 유출되어도 출금은 불가능하므로 상대적으로 안전합니다.

---

## 2. 프로젝트 설치

```bash
# 클론
git clone https://github.com/kevinlimdev-dot/ai-trader.git
cd ai-trader

# 의존성 설치
bun install

# 대시보드 의존성 설치
cd dashboard && bun install && cd ..
```

### 디렉토리 구조 확인

```bash
ls skills/          # data-collector, analyzer, ai-decision, trader, wallet-manager
ls src/             # runner.ts, position-monitor.ts, services/, utils/
ls dashboard/src/   # SvelteKit 대시보드
```

---

## 3. 환경 변수 설정

```bash
cp .env.example .env
```

`.env` 파일을 편집합니다:

```env
# 하이퍼리퀴드 (필수)
HYPERLIQUID_PRIVATE_KEY=your_hyperliquid_api_wallet_private_key
HYPERLIQUID_DEPOSIT_ADDRESS=your_hyperliquid_deposit_address

# 데이터베이스
DATABASE_PATH=data/ai-trader.db
```

> **주의:** `.env` 파일은 `.gitignore`에 포함되어 있어 git에 커밋되지 않습니다. Private Key를 절대 공유하지 마세요.

### HyperLiquid Private Key 찾기

1. HyperLiquid 앱 → Settings → API
2. "Generate API Wallet" 클릭
3. 생성된 Private Key 복사 (0x 없이 64자리 hex)

### HyperLiquid Deposit Address 찾기

1. HyperLiquid 앱 → Portfolio → Deposit
2. Arbitrum 네트워크 입금 주소 복사

---

## 4. HyperLiquid 설정

### config.yaml 확인

`config.yaml`에서 거래 설정을 확인하고 필요에 따라 조정합니다:

```yaml
general:
  mode: paper          # paper(모의) / live(실제) — 처음에는 paper로 시작
  strategy: balanced   # conservative / balanced / aggressive
```

### 주요 설정

| 항목 | 기본값 | 설명 |
|------|--------|------|
| `general.mode` | `paper` | `paper`: 모의 거래, `live`: 실제 거래 |
| `general.strategy` | `balanced` | 전략 프리셋 |
| `trade_agent.leverage.default` | `5` | 기본 레버리지 |
| `trade_agent.leverage.max` | `10` | 최대 레버리지 |
| `trade_agent.risk.risk_per_trade` | `0.03` | 거래당 리스크 (3%) |
| `trade_agent.risk.max_concurrent_positions` | `6` | 최대 동시 포지션 |
| `trade_agent.risk.min_balance_usdc` | `100` | 최소 잔고 ($100) |
| `runner.interval_sec` | `300` | 파이프라인 실행 주기 (5분) |

### 전략 프리셋

| 전략 | 레버리지 | 리스크/거래 | R:R | 최대 포지션 | 설명 |
|------|---------|------------|-----|-----------|------|
| conservative | 5x | 2% | 1.5 | 5 | 보수적, 확실한 시그널만 |
| balanced | 7x | 3% | 2.0 | 6 | 선별적 진입, 안정 승률 |
| aggressive | 10x | 5% | 4.0 | 15 | 모멘텀 추종, 고빈도 |

---

## 5. OpenClaw 설정

OpenClaw는 AI 에이전트가 자율적으로 거래 판단을 내리고 스크립트를 실행하는 핵심 엔진입니다.

### 5.1 설치 및 초기 설정

```bash
# OpenClaw 설치
bun add -g openclaw

# 초기 설정 (모델, 게이트웨이 등)
openclaw configure

# 데몬 시작
openclaw daemon start
```

> **모델 선택:** 설정 시 `openai/gpt-5-mini` 또는 원하는 모델을 선택합니다. OpenAI API 키가 필요합니다.

### 5.2 trader 에이전트 생성

```bash
# trader 전용 에이전트 생성 (워크스페이스 = 프로젝트 루트)
openclaw agents add trader \
  --workspace /path/to/ai-trader \
  --model openai/gpt-5-mini \
  --non-interactive
```

### 5.3 실행 권한 설정

`trader` 에이전트가 셸 명령을 실행할 수 있도록 허용합니다:

```bash
# 모든 명령 허용 (필수)
openclaw approvals allowlist add --agent trader "*"
```

> **참고:** 이 설정 없이는 에이전트가 `bun run ...` 명령을 실행하지 못하고 텍스트 응답만 합니다.

### 5.4 설정 확인

```bash
# 에이전트 목록 확인
openclaw agents list

# 실행 권한 확인
openclaw approvals get

# 데몬 상태 확인
openclaw daemon status
```

예상 출력:
```
Agents:
- main (default)
- trader
  Workspace: ~/path/to/ai-trader
  Model: openai/gpt-5-mini
```

### 5.5 프로젝트 파일 확인

프로젝트 루트에 아래 파일들이 있어야 합니다:

| 파일 | 역할 |
|------|------|
| `SOUL.md` | trader 에이전트 핵심 원칙 (자율 실행, 질문 금지) |
| `AGENTS.md` | 워크스페이스 규칙 |
| `.openclaw/skills/ai-trader/SKILL.md` | 7단계 파이프라인 정의 |

---

## 6. 데이터베이스 초기화

```bash
bun run setup-db
```

이 명령은 `data/ai-trader.db` SQLite 데이터베이스를 생성하고 필요한 테이블을 만듭니다:
- `trades` — 거래 기록
- `balance_snapshots` — 잔고 스냅샷
- `price_snapshots` — 가격 스냅샷
- `transfers` — 전송 기록

---

## 7. 대시보드 설치

```bash
cd dashboard
bun install
bun run dev
```

브라우저에서 `http://localhost:5173` 으로 접속합니다.

### 대시보드 페이지

| 페이지 | URL | 설명 |
|--------|-----|------|
| 메인 | `/` | KPI, 차트, 오픈 포지션, 최근 거래 |
| 시그널 | `/signals` | LONG/SHORT/HOLD 시그널 분석 |
| 거래 내역 | `/trades` | 전체 거래 기록 (필터, 페이지네이션) |
| 포지션 | `/positions` | 포지션 상세 |
| 지갑 | `/wallet` | 잔고, 입금 주소, Arb→HL 입금 |
| 컨트롤 | `/control` | 러너/모니터 제어, 전략 선택, 개별 청산 |

---

## 8. 실행 확인

### 8.1 가격 수집 테스트

```bash
bun run collect
```

예상 출력: `수집 완료: 31개 코인` + `data/snapshots/latest.json` 생성

### 8.2 시그널 분석 테스트

```bash
bun run analyze
```

예상 출력: 각 코인의 LONG/SHORT/HOLD 시그널 + `data/signals/latest.json` 생성

### 8.3 OpenClaw 연동 테스트

```bash
openclaw agent --agent trader \
  --session-id test-1 \
  --message 'ai-trader 스킬의 1단계(가격 수집)만 실행하고 결과를 보고해.'
```

실제로 `bun run collect-prices.ts`가 실행되어야 합니다 (10~20초 소요).

### 8.4 전체 파이프라인 1회 테스트 (Paper 모드)

```bash
# config.yaml에서 mode: paper 확인 후
bun run runner:once
```

7단계 파이프라인이 순서대로 실행됩니다. Paper 모드에서는 실제 주문 없이 시뮬레이션합니다.

---

## 9. 자동매매 시작

### 9.1 Paper 모드에서 테스트

```bash
# config.yaml: mode: paper 확인

# 자동매매 시작 (5분 간격 반복)
bun run runner
```

대시보드(`http://localhost:5173`)에서 실시간으로 상태를 모니터링할 수 있습니다.

### 9.2 Live 모드 전환

Paper 모드에서 충분히 테스트한 후:

1. 대시보드 → Control → Trading Mode → **LIVE** 클릭
2. 또는 `config.yaml`에서 `general.mode: live`로 변경

> **주의:** Live 모드에서는 실제 자금으로 거래가 실행됩니다.

### 9.3 백그라운드 실행

```bash
# 러너를 백그라운드에서 실행
nohup bun run runner > data/runner.log 2>&1 &

# 상태 확인
cat /tmp/ai-trader-runner-status.json
```

### 9.4 대시보드에서 제어

대시보드 Control 페이지에서 모든 것을 제어할 수 있습니다:

- **자동매매 시작/정지**
- **1회 실행**
- **전략 변경** (Conservative / Balanced / Aggressive)
- **포지션 모니터** 시작/정지
- **개별 포지션 청산**
- **Kill Switch** (긴급 중단)

---

## 10. 문제 해결

### OpenClaw 데몬이 실행되지 않음

```bash
openclaw daemon status
# "not loaded" → 시작 필요
openclaw daemon start
```

### OpenClaw가 명령을 실행하지 않음 (텍스트만 응답)

exec-approvals가 설정되지 않았을 가능성:

```bash
openclaw approvals get
# Allowlist가 비어있으면:
openclaw approvals allowlist add --agent trader "*"
```

### "Invalid leverage value" 오류

에셋의 최대 레버리지가 설정값보다 낮은 경우. 코드에서 자동 클램프가 적용되지만, 로그에서 확인:

```bash
# 로그에서 레버리지 클램프 확인
# "VVV 레버리지 클램프: 5x → 3x (최대: 3x)" 형태로 출력됨
```

### 주문 실패 (Order could not immediately match)

슬리피지가 부족한 경우. `reduceOnly` 주문은 자동으로 3x 슬리피지가 적용됩니다.
지속적으로 실패하면 `config.yaml`에서 `slippage` 값을 올려보세요:

```yaml
trade_agent:
  hyperliquid:
    slippage: 0.02  # 1% → 2%
```

### 데이터베이스 잠금 오류

```bash
# WAL 모드 확인
bun run setup-db
```

### Kill Switch 해제

```bash
rm data/KILL_SWITCH
```

### 대시보드가 열리지 않음

```bash
cd dashboard
bun install
bun run dev
# http://localhost:5173 접속
```

### 러너 상태 확인

```bash
cat /tmp/ai-trader-runner-status.json | python3 -m json.tool
```

---

## 부록: npm 스크립트 목록

| 명령 | 설명 |
|------|------|
| `bun run collect` | 가격 수집 |
| `bun run analyze` | 시그널 분석 |
| `bun run trade` | 거래 실행 |
| `bun run wallet` | 지갑 관리 |
| `bun run deposit` | Arbitrum → HL 입금 |
| `bun run monitor` | 포지션 모니터 (연속) |
| `bun run monitor:once` | 포지션 모니터 (1회) |
| `bun run runner` | 자동매매 러너 (연속) |
| `bun run runner:once` | 자동매매 러너 (1회) |
| `bun run setup-db` | 데이터베이스 초기화 |
| `bun run dashboard` | 대시보드 실행 |
| `bun run dashboard:build` | 대시보드 빌드 |
