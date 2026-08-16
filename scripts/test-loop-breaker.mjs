#!/usr/bin/env node
/**
 * Killcord — Rogue Agent Loop Breaker Test
 *
 * Scenarios:
 *  1. Instant history-scan trip    — single request with 7 tool_use blocks
 *  2. Growing agent loop           — history grows by 1 tool_use per request
 *  3. Request-flood trip           — rapid requests exceed CB_REQUEST_LIMIT
 *  4. Complexity header            — X-Killcord-Complexity emitted correctly
 *
 * Usage (recommended — self-managed, no external proxy needed):
 *   npm run test:proxy
 *   node scripts/test-loop-breaker.mjs --managed
 *
 * Usage (against an already-running proxy):
 *   node scripts/test-loop-breaker.mjs [host]
 *
 * --managed mode:
 *   Starts a mock upstream + the proxy with CB_REQUEST_LIMIT=5 so the
 *   flood test completes well within the 60s sliding window.
 *   Requires the proxy source to be present and tsx/node installed.
 */

import { createServer }           from 'node:http';
import { spawn }                  from 'node:child_process';
import { fileURLToPath }          from 'node:url';
import { join, dirname }          from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

const __dir   = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(__dir, '..');

const MANAGED    = process.argv.includes('--managed');
const BASE       = MANAGED ? 'http://localhost:18080' : (process.argv.find(a => a.startsWith('http')) ?? 'http://localhost:8080');
const CB_LIMIT   = MANAGED ? 5 : parseInt(process.env.CB_REQUEST_LIMIT ?? '30', 10);
const MOCK_PORT  = 19998;
const PROXY_PORT = 18080;
const TRACE_DIR  = '/tmp/killcord-test-traces';

let passed = 0, failed = 0;
let proxyProc = null, mockServer = null;

// ── Cleanup ───────────────────────────────────────────────────────────────────

async function cleanup() {
  if (proxyProc) { proxyProc.kill('SIGTERM'); proxyProc = null; }
  if (mockServer) await new Promise(r => mockServer.close(r));
}
process.on('exit', () => { if (proxyProc) proxyProc.kill('SIGTERM'); });
process.on('SIGINT',  async () => { await cleanup(); process.exit(1); });
process.on('SIGTERM', async () => { await cleanup(); process.exit(1); });

// ── Mock upstream server ──────────────────────────────────────────────────────
// Returns a minimal OpenAI-compatible 200 response for any POST.

async function startMockUpstream() {
  return new Promise((resolve, reject) => {
    mockServer = createServer((req, res) => {
      // Connection: close prevents undici keep-alive reuse which causes ECONNRESET on a
      // test-only server that isn't managing persistent connections.
      res.writeHead(200, { 'content-type': 'application/json', 'connection': 'close' });
      res.end(JSON.stringify({
        id:      'mock-resp',
        object:  'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage:   { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }));
    });
    mockServer.listen(MOCK_PORT, '127.0.0.1', () => resolve(mockServer));
    mockServer.once('error', reject);
  });
}

// ── Proxy lifecycle (managed mode only) ───────────────────────────────────────

async function startProxy() {
  const mockBase = `http://127.0.0.1:${MOCK_PORT}`;
  proxyProc = spawn('npx', ['tsx', join(srcRoot, 'src/index.ts')], {
    env: {
      ...process.env,
      PORT:                        String(PROXY_PORT),
      WORKERS:                     '1',
      ADMIN_API_KEY:               '',
      CB_REQUEST_LIMIT:            String(CB_LIMIT),
      CB_TOOL_REPEAT_LIMIT:        '5',
      CB_WINDOW_MS:                '60000',
      ANTHROPIC_UPSTREAM:              mockBase,
      OPENAI_UPSTREAM:                 mockBase,
      KILLCORD_TRACE_ENABLED:          'true',
      KILLCORD_TRACE_DIR:              TRACE_DIR,
      KILLCORD_SEMANTIC_LOOP_ENABLED:  'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proxyProc.stdout.on('data', d => process.stdout.write(`[proxy] ${d}`));
  proxyProc.stderr.on('data', d => process.stderr.write(`[proxy] ${d}`));
  proxyProc.on('exit', code => { if (code !== null && code !== 0) console.error(`[proxy] Exited with code ${code}`); });

  // Wait until /health responds
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise(r => setTimeout(r, 500));
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch { /* still starting */ }
  }
  throw new Error('Proxy did not start within 20s');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function post(path, body, headers = {}) {
  const res  = await fetch(`${BASE}${path}`, {
    method:  'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body:    JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, headers: res.headers, body: json };
}

function ok(label, cond, actual) {
  if (cond) {
    console.log(`✅ ${label}`);
    passed++;
  } else {
    console.error(`❌ ${label}  (got: ${JSON.stringify(actual)})`);
    failed++;
  }
}

// Build an Anthropic-style conversation with `n` tool_use + tool_result pairs.
function buildAnthropicLoop(toolName, toolCallCount) {
  const msgs = [{ role: 'user', content: `search for: ${toolName}` }];
  for (let i = 0; i < toolCallCount; i++) {
    msgs.push({
      role:    'assistant',
      content: [{ type: 'tool_use', id: `tu_${i}`, name: toolName, input: { q: 'test' } }],
    });
    msgs.push({
      role:    'user',
      content: [{ type: 'tool_result', tool_use_id: `tu_${i}`, content: 'result' }],
    });
  }
  msgs.push({ role: 'user', content: 'continue' });
  return msgs;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

console.log(`\n── Killcord Circuit Breaker Test${MANAGED ? ' [managed mode]' : ''} ──`);
console.log(`Proxy: ${BASE}  CB_REQUEST_LIMIT: ${CB_LIMIT}\n`);

if (MANAGED) {
  console.log('Starting mock upstream...');
  await startMockUpstream();
  console.log(`Mock upstream ready on :${MOCK_PORT}\n`);
  console.log('Starting proxy (this may take a few seconds for model warmup)...');
  await startProxy();
  console.log('Proxy ready.\n');
} else {
  try {
    const h = await fetch(`${BASE}/health`);
    if (!h.ok) throw new Error(`HTTP ${h.status}`);
    console.log(`✅ Proxy is up\n`);
  } catch (err) {
    console.error(`❌ Cannot reach proxy at ${BASE}: ${err.message}`);
    console.error('Start with: WORKERS=1 KILLCORD_REQUIRE_LICENSE_KEY=false npm run dev');
    console.error('Or use: node scripts/test-loop-breaker.mjs --managed');
    process.exit(1);
  }
}

// ── Scenario 1: Instant history-scan trip ────────────────────────────────────

console.log('Scenario 1 — Single request, 7 tool_use blocks in history');

const s1 = await post('/v1/messages', {
  model:      'claude-3-5-sonnet-20241022',
  messages:   buildAnthropicLoop('web_search', 7), // 7 > TOOL_REPEAT_LIMIT of 5
  max_tokens: 1024,
});

ok('S1: status 429',                s1.status === 429,                            s1.status);
ok('S1: error = circuit_breaker',   s1.body?.error === 'circuit_breaker_tripped', s1.body?.error);
ok('S1: reason = tool_loop',        s1.body?.reason === 'tool_loop',              s1.body?.reason);
ok('S1: detail mentions tool name', s1.body?.detail?.includes('web_search'),      s1.body?.detail);
ok('S1: retry_after present',       typeof s1.body?.retry_after === 'number',     s1.body?.retry_after);
console.log(`  detail: ${s1.body?.detail}\n`);

// ── Scenario 2: Growing agent loop ───────────────────────────────────────────

console.log('Scenario 2 — Simulated growing agent loop (history accumulates per request)');
console.log('  Expect CB trip when history exceeds 5 tool_use blocks\n');

const loopSession = `loop-grow-${Date.now()}`;
let firstGrownTrip = null;

for (let calls = 1; calls <= 8; calls++) {
  const r = await post('/v1/messages', {
    model:      'claude-3-5-sonnet-20241022',
    messages:   buildAnthropicLoop('database_query', calls),
    max_tokens: 1024,
  }, { 'x-killcord-session-id': loopSession });

  const tripped = r.status === 429 && r.body?.error === 'circuit_breaker_tripped';
  process.stdout.write(tripped ? '🔴' : '🟢');
  if (tripped && !firstGrownTrip) firstGrownTrip = { calls, body: r.body };
}
process.stdout.write('\n\n');

ok('S2: CB tripped during growing loop',   firstGrownTrip !== null,                   'never tripped');
ok('S2: tripped at exactly 6 in history',  firstGrownTrip?.calls === 6,               firstGrownTrip?.calls);
ok('S2: reason = tool_loop',               firstGrownTrip?.body?.reason === 'tool_loop', firstGrownTrip?.body?.reason);

if (firstGrownTrip) console.log(`  First trip: ${firstGrownTrip.calls} tool_use blocks  detail: ${firstGrownTrip.body?.detail}\n`);

// ── Scenario 3: Request-flood ─────────────────────────────────────────────────

const FLOOD_SEND = CB_LIMIT + 5;
console.log(`Scenario 3 — Request-flood: ${FLOOD_SEND} rapid requests from same session`);
console.log(`  CB_REQUEST_LIMIT=${CB_LIMIT}; expect CB trip at request ${CB_LIMIT + 1}\n`);

const floodSession = `flood-${Date.now()}`;
const simpleBody   = { model: 'gpt-4o', messages: [{ role: 'user', content: 'ping' }] };

let floodTrips = 0, firstFloodTrip = null;

for (let i = 1; i <= FLOOD_SEND; i++) {
  const r = await post('/v1/chat/completions', simpleBody, {
    'x-killcord-session-id': floodSession,
  });
  const tripped = r.status === 429 && r.body?.error === 'circuit_breaker_tripped';
  process.stdout.write(tripped ? '🔴' : '🟢');
  if (i % 10 === 0) process.stdout.write(` ${i}\n`);
  if (tripped) { floodTrips++; if (!firstFloodTrip) firstFloodTrip = { i, body: r.body }; }
}
process.stdout.write('\n\n');

ok('S3: CB tripped at least once',
   floodTrips > 0,
   `tripped ${floodTrips}× across ${FLOOD_SEND} requests`);

ok(`S3: first trip at request ≤ ${CB_LIMIT + 2}`,
   firstFloodTrip && firstFloodTrip.i <= CB_LIMIT + 2,
   firstFloodTrip ? `first trip at #${firstFloodTrip.i}` : 'never tripped');

ok('S3: reason = request_flood',
   firstFloodTrip?.body?.reason === 'request_flood',
   firstFloodTrip?.body?.reason ?? 'n/a');

if (firstFloodTrip) console.log(`  First flood trip at request #${firstFloodTrip.i}: ${firstFloodTrip.body?.detail}\n`);

// ── Scenario 4: Complexity classification ────────────────────────────────────

console.log('Scenario 4 — Complexity header emitted on non-CB requests');

const [complexReq, simpleReq] = await Promise.all([
  post('/v1/chat/completions',
    { model: 'gpt-4o', messages: [{ role: 'user', content: 'analyze and synthesize the quarterly financial reports to evaluate performance' }] },
    { 'x-killcord-session-id': `cplx-a-${Date.now()}` }),
  post('/v1/chat/completions',
    { model: 'gpt-4o', messages: [{ role: 'user', content: 'what is 2 + 2' }] },
    { 'x-killcord-session-id': `cplx-b-${Date.now()}` }),
]);

const complexHeader = complexReq.headers.get('x-killcord-complexity');
const simpleHeader  = simpleReq.headers.get('x-killcord-complexity');

ok('S4: complex prompt → "complex"', complexHeader === 'complex', complexHeader ?? '(not set)');
ok('S4: simple prompt → "simple"',   simpleHeader  === 'simple',  simpleHeader  ?? '(not set)');

console.log(`  Complex: ${complexHeader} (score ${complexReq.headers.get('x-killcord-complexity-score')})`);
console.log(`  Simple:  ${simpleHeader}  (score ${simpleReq.headers.get('x-killcord-complexity-score')})`);

// ── Scenario 5: Semantic loop detection ──────────────────────────────────────
// 4 turns with the same tool name but rephrased NL queries. Exact-match won't
// fire (4 < CB_TOOL_REPEAT_LIMIT=5). Semantic fires at turn #4 because the
// embeddings of "docker permission denied" phrased four ways are all >0.94 cosine.
// Requires the MiniLM model to be warm — in managed mode, give it time to load.

console.log('Scenario 5 — Semantic loop detection (rephrased queries, exact-match misses)');

if (MANAGED) {
  process.stdout.write('  Waiting 6 s for MiniLM embedder to warm up...');
  await new Promise(r => setTimeout(r, 6000));
  console.log(' done');
}

function buildRewordedLoop(queries) {
  const msgs = [{ role: 'user', content: 'fix the docker error' }];
  const queries4 = queries.slice(0, 4);
  for (let i = 0; i < queries4.length; i++) {
    msgs.push({
      role:    'assistant',
      content: [{ type: 'tool_use', id: `rw_${i}`, name: 'search_web', input: { query: queries4[i] } }],
    });
    msgs.push({
      role:    'user',
      content: [{ type: 'tool_result', tool_use_id: `rw_${i}`, content: 'no relevant results' }],
    });
  }
  msgs.push({ role: 'user', content: 'keep trying' });
  return msgs;
}

const s5 = await post('/v1/messages', {
  model:      'claude-3-5-sonnet-20241022',
  messages:   buildRewordedLoop([
    'how to fix docker permission denied error',
    'fixing docker permission denied issue',
    'resolve docker permission denied problem',
    'docker permission denied how do i solve it',
  ]),
  max_tokens: 1024,
});

const s5Semantic = s5.status === 429 && s5.body?.reason === 'semantic_loop';
const s5Exact    = s5.status === 429 && s5.body?.reason === 'tool_loop';

if (s5Semantic) {
  ok('S5: semantic loop detected (429)',   true, null);
  ok('S5: mechanism = semantic',           s5.body?.mechanism === 'semantic', s5.body?.mechanism);
  ok('S5: similarity score present',       typeof s5.body?.similarity === 'number', s5.body?.similarity);
  ok('S5: exact-match did NOT trip first', !s5Exact, 'exact fired instead');
  console.log(`  similarity: ${s5.body?.similarity}  detail: ${s5.body?.detail}\n`);
} else if (s5Exact) {
  ok('S5: semantic loop detected',         false, 'exact-match fired instead — embedder may not be warm yet');
  failed++;
  console.log(`  Tip: run with a warmed proxy or increase the warmup wait above.\n`);
} else {
  ok('S5: semantic loop detected (429)',   false, `status=${s5.status} reason=${s5.body?.reason}`);
  // Model might still be loading — log for debugging
  console.log(`  body: ${JSON.stringify(s5.body)}\n`);
}

// ── Scenario 6: Trace capture ─────────────────────────────────────────────────
// After any successful proxied request, KILLCORD_TRACE_DIR should contain at
// least one JSONL file with valid trace records.

console.log('Scenario 6 — Trace file written with valid JSONL');

const traceExists    = existsSync(TRACE_DIR);
const traceFiles     = traceExists ? readdirSync(TRACE_DIR).filter(f => f.endsWith('.jsonl')) : [];

ok('S6: trace directory exists',    traceExists,          TRACE_DIR);
ok('S6: at least one .jsonl file',  traceFiles.length > 0, `found ${traceFiles.length} files`);

if (traceFiles.length > 0) {
  // Read first non-empty JSONL line from any trace file
  let sampleLine = null;
  for (const f of traceFiles) {
    const raw = readFileSync(join(TRACE_DIR, f), 'utf-8').trim();
    const lines = raw.split('\n').filter(Boolean);
    if (lines.length > 0) { sampleLine = lines[0]; break; }
  }

  let parsed = null;
  try { parsed = sampleLine ? JSON.parse(sampleLine) : null; } catch { /* invalid */ }

  ok('S6: JSONL lines are valid JSON',   parsed !== null,                                sampleLine?.slice(0, 80));
  ok('S6: trace has traceId',            typeof parsed?.traceId === 'string',            parsed?.traceId);
  ok('S6: trace has latencyMs',          typeof parsed?.latencyMs === 'number',          parsed?.latencyMs);
  ok('S6: trace has upstreamStatus',     typeof parsed?.upstreamStatus === 'number',     parsed?.upstreamStatus);
  ok('S6: trace has circuitBreaker',     parsed?.circuitBreaker !== undefined,           null);
  ok('S6: no raw email in trace (PII)',   !JSON.stringify(parsed).match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/i), 'email found');
  console.log(`  traceId=${parsed?.traceId}  latency=${parsed?.latencyMs}ms  status=${parsed?.upstreamStatus}\n`);
}

// ── Teardown + summary ────────────────────────────────────────────────────────

if (MANAGED) await cleanup();

console.log(`\n── Results: ${passed} passed, ${failed} failed ──\n`);
process.exit(failed > 0 ? 1 : 0);
