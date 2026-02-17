/**
 * AI 투자 결정 적용 스크립트
 *
 * OpenClaw AI가 내린 투자 결정을 시그널 파일에 반영한다.
 * AI가 승인한 거래만 남기고, confidence를 조정하며, 거부한 거래는 HOLD로 변경한다.
 *
 * 사용법:
 *   bun run skills/ai-decision/scripts/apply-decision.ts --decisions '[{"symbol":"BTC","action":"LONG","confidence":0.8,"reason":"강한 상승 모멘텀"},{"symbol":"ETH","action":"HOLD","reason":"불확실"}]'
 *
 * decisions JSON 형식:
 *   symbol: 코인 심볼 (필수)
 *   action: "LONG" | "SHORT" | "HOLD" (필수) — HOLD로 설정하면 해당 거래를 제외
 *   confidence: 0.0~1.0 (선택) — AI가 조정한 확신도. 미제공 시 원래 값 유지
 *   reason: string (선택) — AI의 판단 근거
 */

import { resolve } from "path";
import { existsSync, readFileSync } from "fs";
import { getProjectRoot } from "../../../src/utils/config";
import { atomicWrite } from "../../../src/utils/file";

const root = getProjectRoot();

function parseArgs(): { decisions: string } {
  const args = process.argv.slice(2);
  const idx = args.indexOf("--decisions");
  if (idx < 0 || !args[idx + 1]) {
    console.error(JSON.stringify({ error: "--decisions 인자가 필요합니다." }));
    process.exit(1);
  }
  return { decisions: args[idx + 1] };
}

async function main() {
  const { decisions: decisionsRaw } = parseArgs();

  let aiDecisions: Array<{
    symbol: string;
    action: "LONG" | "SHORT" | "HOLD";
    confidence?: number;
    reason?: string;
  }>;

  try {
    aiDecisions = JSON.parse(decisionsRaw);
  } catch {
    console.error(JSON.stringify({ error: "decisions JSON 파싱 실패" }));
    process.exit(1);
    return;
  }

  // 기존 시그널 읽기
  const signalPath = resolve(root, "data/signals/latest.json");
  if (!existsSync(signalPath)) {
    console.error(JSON.stringify({ error: "시그널 파일이 없습니다." }));
    process.exit(1);
    return;
  }

  const raw = readFileSync(signalPath, "utf-8");
  const collection = JSON.parse(raw);

  // AI 결정 적용
  let approved = 0;
  let rejected = 0;
  let modified = 0;

  for (const signal of collection.signals) {
    const decision = aiDecisions.find((d) => d.symbol === signal.symbol);

    if (decision) {
      if (decision.action === "HOLD") {
        // AI가 거부 → HOLD로 변경
        signal.action = "HOLD";
        signal.ai_reason = decision.reason || "AI 판단: 진입 보류";
        rejected++;
      } else {
        // AI가 승인 (방향 변경 가능)
        signal.action = decision.action;
        if (decision.confidence !== undefined) {
          signal.confidence = decision.confidence;
          modified++;
        }
        signal.ai_reason = decision.reason || "AI 승인";
        approved++;
      }
    }
    // AI 결정에 없는 시그널은 원래 상태 유지 (HOLD는 그대로 HOLD)
  }

  // AI 메타데이터 추가
  collection.ai_reviewed = true;
  collection.ai_review_at = new Date().toISOString();
  collection.ai_summary = {
    total_candidates: aiDecisions.length,
    approved,
    rejected,
    modified,
  };

  // 저장
  await atomicWrite(signalPath, collection);

  console.log(JSON.stringify({
    status: "success",
    approved,
    rejected,
    modified,
    message: `AI 결정 적용 완료: ${approved}건 승인, ${rejected}건 거부, ${modified}건 확신도 조정`,
  }));
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
});
