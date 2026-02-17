#!/usr/bin/env node
/**
 * awal sidecar — 대시보드와 별도로 실행되며
 * 주기적으로 awal Electron 서버에 IPC 요청을 보내고
 * 결과를 JSON 캐시 파일에 기록합니다.
 *
 * 사용법: node scripts/awal-sidecar.cjs
 *
 * 대시보드(Vite SSR)는 이 파일만 읽으면 됩니다.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

process.title = 'awal-cli';

const IPC_DIR = '/tmp/payments-mcp-ui-bridge';
const REQUESTS_DIR = path.join(IPC_DIR, 'requests');
const RESPONSES_DIR = path.join(IPC_DIR, 'responses');
const LOCK_FILE = '/tmp/payments-mcp-ui.lock';
const CACHE_FILE = '/tmp/ai-trader-awal-cache.json';
const POLL_INTERVAL = 15_000; // 15초마다 갱신

// ─── IPC 요청 ───

async function sendIpc(channel, data = {}) {
  // 서버 실행 확인
  try {
    const pid = parseInt(fs.readFileSync(LOCK_FILE, 'utf-8').trim(), 10);
    process.kill(pid, 0);
  } catch {
    throw new Error('awal server not running');
  }

  for (const dir of [IPC_DIR, REQUESTS_DIR, RESPONSES_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { mode: 0o700, recursive: true });
  }

  const requestId = crypto.randomUUID();
  const requestFile = path.join(REQUESTS_DIR, requestId + '.json');
  const responseFile = path.join(RESPONSES_DIR, requestId + '.json');

  fs.writeFileSync(requestFile, JSON.stringify({
    id: requestId,
    channel,
    data,
    timestamp: Date.now(),
    pid: process.pid,
    processTitle: process.title,
  }, null, 2), { mode: 0o600 });

  // 폴링 대기 (최대 10초)
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (fs.existsSync(responseFile)) {
      const raw = fs.readFileSync(responseFile, 'utf-8');
      try { fs.unlinkSync(responseFile); } catch {}
      const resp = JSON.parse(raw);
      if (resp.error) throw new Error(typeof resp.error === 'string' ? resp.error : JSON.stringify(resp.error));
      return resp.result;
    }
    await new Promise(r => setTimeout(r, 50));
  }

  try { fs.unlinkSync(requestFile); } catch {}
  throw new Error('IPC timeout');
}

// ─── 캐시 기록 ───

function writeCache(cache) {
  try {
    const tmp = CACHE_FILE + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
    fs.renameSync(tmp, CACHE_FILE);
  } catch (err) {
    // rename 실패 시 직접 쓰기 fallback
    try {
      fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
    } catch {}
  }
}

// ─── 메인 루프 ───

async function refresh() {
  const cache = {
    status: 'unknown',
    balance: 0,
    address: null,
    updatedAt: new Date().toISOString(),
    error: null,
  };

  // 1. status
  try {
    const result = await sendIpc('check-session-status', {});
    const str = typeof result === 'string' ? result : '';
    if (str.includes('Authenticated') && !str.includes('Not Authenticated')) {
      cache.status = 'ok';
    } else {
      cache.status = 'error';
      cache.error = 'Not authenticated';
    }
  } catch (err) {
    cache.status = 'error';
    cache.error = err.message;
    writeCache(cache);
    return;
  }

  if (cache.status !== 'ok') {
    writeCache(cache);
    return;
  }

  // 2. balance
  try {
    const result = await sendIpc('get-wallet-balance', { assets: ['USDC'] });
    if (result?.balances?.USDC) {
      const raw = result.balances.USDC.raw ?? '0';
      const decimals = result.balances.USDC.decimals ?? 6;
      cache.balance = parseInt(raw, 10) / (10 ** decimals);
    }
  } catch (err) {
    console.error('[sidecar] balance error:', err.message);
  }

  // 3. address
  try {
    const result = await sendIpc('get-wallet-address', {});
    const addr = typeof result === 'string' ? result : '';
    if (addr.startsWith('0x') && addr.length === 42) {
      cache.address = addr;
    }
  } catch (err) {
    console.error('[sidecar] address error:', err.message);
  }

  writeCache(cache);
  console.log(`[sidecar] updated — status=${cache.status} balance=${cache.balance} addr=${cache.address ? cache.address.slice(0, 10) + '...' : 'none'}`);
}

async function loop() {
  console.log('[awal-sidecar] started — polling every', POLL_INTERVAL / 1000, 'seconds');
  console.log('[awal-sidecar] cache file:', CACHE_FILE);

  let lastError = '';
  let errorCount = 0;

  while (true) {
    try {
      await refresh();
      if (errorCount > 0) {
        console.log('[sidecar] recovered after', errorCount, 'errors');
        errorCount = 0;
        lastError = '';
      }
    } catch (err) {
      errorCount++;
      if (err.message !== lastError || errorCount % 20 === 1) {
        console.error('[sidecar] error (' + errorCount + 'x):', err.message);
        lastError = err.message;
      }
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
}

loop();
