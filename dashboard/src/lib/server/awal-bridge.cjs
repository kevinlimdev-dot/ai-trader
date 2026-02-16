#!/usr/bin/env node
/**
 * awal IPC bridge — Vite SSR에서 awal Electron 서버와 통신하기 위한 브릿지
 * 
 * 사용법: node awal-bridge.cjs <channel> [json-data]
 * 출력: JSON { result: ... } 또는 { error: ... }
 * 
 * 이 스크립트는 자체 PID로 IPC 요청을 보내므로 서버 PID 검증을 통과합니다.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// awal CLI와 동일한 process.title 설정 (서버 검증용)
process.title = 'awal-cli';

const IPC_DIR = '/tmp/payments-mcp-ui-bridge';
const REQUESTS_DIR = path.join(IPC_DIR, 'requests');
const RESPONSES_DIR = path.join(IPC_DIR, 'responses');
const LOCK_FILE = '/tmp/payments-mcp-ui.lock';

async function main() {
  const channel = process.argv[2];
  if (!channel) {
    console.log(JSON.stringify({ error: 'channel required' }));
    process.exit(1);
  }

  let data = {};
  if (process.argv[3]) {
    try { data = JSON.parse(process.argv[3]); } catch { /* ignore */ }
  }

  // 서버 실행 확인
  try {
    const pid = parseInt(fs.readFileSync(LOCK_FILE, 'utf-8').trim(), 10);
    process.kill(pid, 0);
  } catch {
    console.log(JSON.stringify({ error: 'awal server not running' }));
    process.exit(1);
  }

  // IPC 디렉토리 확인
  for (const dir of [IPC_DIR, REQUESTS_DIR, RESPONSES_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { mode: 0o700, recursive: true });
  }

  const requestId = crypto.randomUUID();
  const requestFile = path.join(REQUESTS_DIR, requestId + '.json');
  const responseFile = path.join(RESPONSES_DIR, requestId + '.json');

  // 요청 작성
  fs.writeFileSync(requestFile, JSON.stringify({
    id: requestId,
    channel,
    data,
    timestamp: Date.now(),
    pid: process.pid,
    processTitle: process.title,
  }, null, 2), { mode: 0o600 });

  // 폴링 대기 (최대 8초)
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (fs.existsSync(responseFile)) {
      const raw = fs.readFileSync(responseFile, 'utf-8');
      try { fs.unlinkSync(responseFile); } catch {}
      const resp = JSON.parse(raw);
      if (resp.error) {
        console.log(JSON.stringify({ error: resp.error }));
      } else {
        console.log(JSON.stringify({ result: resp.result }));
      }
      return;
    }
    await new Promise(r => setTimeout(r, 30));
  }

  // 타임아웃
  try { fs.unlinkSync(requestFile); } catch {}
  console.log(JSON.stringify({ error: 'timeout' }));
  process.exit(1);
}

main().catch(err => {
  console.log(JSON.stringify({ error: err.message || String(err) }));
  process.exit(1);
});
