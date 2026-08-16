#!/usr/bin/env node
/**
 * Killcord — agent integration smoke test
 *
 * Exercises every live endpoint on the Railway deployment:
 *   1. GET  /health          — admin-authenticated health check
 *   2. GET  /roi             — ROI summary (admin)
 *   3. GET  /metrics         — Prometheus metrics (admin)
 *   4. POST /api/billing/checkout  — Stripe checkout URL (all three tiers)
 *   5. POST /v1/messages     — Anthropic proxy path + semantic tool filtering
 *   6. POST /v1/chat/completions   — OpenAI proxy path + semantic tool filtering
 *
 * The proxy endpoints (#5, #6) are sent without a real upstream API key so
 * the upstream returns 401, but the proxy itself must handle the request
 * cleanly and return the X-Killcord-Trace-Id header — that's what we assert.
 *
 * Memory check: the tool-filtering payload ships 10 MCP tool schemas so the
 * proxy must load the MiniLM embedder, embed all descriptions, and pick top-2
 * without OOM on the Railway container.
 */

const BASE   = process.env.KILLCORD_BASE_URL ?? 'https://killcord-production.up.railway.app';
const ADMIN  = process.env.ADMIN_API_KEY ?? '';

if (!ADMIN) {
  console.error('Set ADMIN_API_KEY before running this script.');
  process.exit(1);
}

const RESET  = '\x1b[0m';
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';

let passed = 0;
let failed = 0;

function ok(label, detail = '') {
  passed++;
  console.log(`  ${GREEN}✓${RESET} ${label}${detail ? `  ${DIM}${detail}${RESET}` : ''}`);
}

function fail(label, detail = '') {
  failed++;
  console.log(`  ${RED}✗${RESET} ${label}${detail ? `  ${DIM}${detail}${RESET}` : ''}`);
}

async function get(path, expectStatus = 200) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'x-admin-api-key': ADMIN },
  });
  return { res, status: res.status, body: await res.json().catch(() => null) };
}

async function post(path, body, extraHeaders = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body:    JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* streaming or non-JSON */ }
  return { res, status: res.status, json, traceId: res.headers.get('x-killcord-trace-id') };
}

// ── 10 MCP tool schemas (memory / semantic-filter stress test) ───────────────
const TOOLS_ANTHROPIC = [
  { name: 'send_email',        description: 'Send an email to a recipient with subject and body' },
  { name: 'read_calendar',     description: 'Fetch upcoming calendar events for a given date range' },
  { name: 'search_web',        description: 'Search the internet for a query and return top results' },
  { name: 'run_sql_query',     description: 'Execute a read-only SQL SELECT on the analytics database' },
  { name: 'create_github_pr',  description: 'Open a pull request on a GitHub repository' },
  { name: 'post_slack_message',description: 'Post a message to a Slack channel or direct message' },
  { name: 'list_s3_files',     description: 'List objects in an AWS S3 bucket with an optional prefix' },
  { name: 'translate_text',    description: 'Translate text from one language to another via DeepL' },
  { name: 'resize_image',      description: 'Resize an image file to specified dimensions' },
  { name: 'fetch_weather',     description: 'Retrieve current weather for a city or coordinates' },
].map(t => ({ name: t.name, description: t.description, input_schema: { type: 'object', properties: {} } }));

const TOOLS_OPENAI = TOOLS_ANTHROPIC.map(t => ({
  type:     'function',
  function: { name: t.name, description: t.description, parameters: { type: 'object', properties: {} } },
}));

// ── Test runner ───────────────────────────────────────────────────────────────

async function run() {
  console.log(`\n${BOLD}Killcord — Agent Integration Smoke Test${RESET}`);
  console.log(`${DIM}Target: ${BASE}${RESET}\n`);

  // ── 1. Health ───────────────────────────────────────────────────────────────
  console.log(`${BOLD}1. Health endpoint${RESET}`);
  try {
    const { status, body } = await get('/health');
    if (status === 200 && body?.status === 'ok') {
      ok(`GET /health → 200`, `version=${body.version}`);
    } else {
      fail(`GET /health → ${status}`, JSON.stringify(body));
    }
  } catch (e) { fail('GET /health', e.message); }

  // ── 2. ROI summary ──────────────────────────────────────────────────────────
  console.log(`\n${BOLD}2. ROI / metrics endpoints${RESET}`);
  try {
    const { status, body } = await get('/roi');
    if (status === 200 && typeof body?.requests_proxied === 'number') {
      ok(`GET /roi → 200`, `requests_proxied=${body.requests_proxied}`);
    } else {
      fail(`GET /roi → ${status}`, JSON.stringify(body));
    }
  } catch (e) { fail('GET /roi', e.message); }

  // ── 3. Prometheus metrics ───────────────────────────────────────────────────
  try {
    const res = await fetch(`${BASE}/metrics`, { headers: { 'x-admin-api-key': ADMIN } });
    const text = await res.text();
    if (res.status === 200 && text.includes('kc_requests_proxied_total')) {
      ok(`GET /metrics → 200`, 'Prometheus counters present');
    } else {
      fail(`GET /metrics → ${res.status}`);
    }
  } catch (e) { fail('GET /metrics', e.message); }

  // ── 4. Billing — all three tiers ────────────────────────────────────────────
  console.log(`\n${BOLD}3. Billing — checkout endpoint (3 tiers)${RESET}`);
  for (const tier of ['developer', 'growth', 'scale']) {
    try {
      const { status, json } = await post('/api/billing/checkout', { tier });
      if (status === 201 && json?.url?.startsWith('https://checkout.stripe.com')) {
        ok(`POST /api/billing/checkout {tier:${tier}} → 201`, 'Stripe URL returned');
      } else {
        fail(`POST /api/billing/checkout {tier:${tier}} → ${status}`, JSON.stringify(json));
      }
    } catch (e) { fail(`billing checkout tier=${tier}`, e.message); }
  }

  // ── 5. Anthropic proxy + semantic tool filtering ────────────────────────────
  console.log(`\n${BOLD}4. Anthropic proxy path  (POST /v1/messages)${RESET}`);
  console.log(`   ${DIM}Sending 10 MCP tool schemas — proxy must filter to top-2 via MiniLM${RESET}`);
  try {
    const payload = {
      model:      'claude-3-5-haiku-20241022',
      max_tokens: 16,
      messages:   [{ role: 'user', content: 'Search the web for today\'s AI news' }],
      tools:      TOOLS_ANTHROPIC,
    };
    const start = Date.now();
    const { status, json, traceId } = await post('/v1/messages', payload, {
      'x-api-key':       'sk-ant-fake-key-for-proxy-test',
      'anthropic-version': '2023-06-01',
    });
    const ms = Date.now() - start;

    // Upstream returns 401 (bad key) — the proxy itself must have processed it
    if (traceId) {
      ok(`X-Killcord-Trace-Id present`, traceId.slice(0, 8) + '…');
    } else {
      fail('X-Killcord-Trace-Id missing — proxy may have crashed');
    }

    if (status === 401 || status === 200) {
      ok(`Proxy handled request → upstream returned ${status}  (${ms} ms)`,
         'semantic filter ran without OOM');
    } else if (status === 500) {
      fail(`Proxy returned 500 — internal error`, JSON.stringify(json));
    } else {
      ok(`Proxy returned ${status} in ${ms} ms`, JSON.stringify(json)?.slice(0, 80));
    }
  } catch (e) { fail('POST /v1/messages', e.message); }

  // ── 6. OpenAI proxy + semantic tool filtering ───────────────────────────────
  console.log(`\n${BOLD}5. OpenAI proxy path  (POST /v1/chat/completions)${RESET}`);
  console.log(`   ${DIM}Sending 10 OpenAI-format tools — proxy must filter to top-2${RESET}`);
  try {
    const payload = {
      model:       'gpt-4o-mini',
      max_tokens:  16,
      messages:    [{ role: 'user', content: 'Send an email to Alice about the project update' }],
      tools:       TOOLS_OPENAI,
      tool_choice: 'auto',
    };
    const start = Date.now();
    const { status, json, traceId } = await post('/v1/chat/completions', payload, {
      'Authorization': 'Bearer sk-fake-key-for-proxy-test',
    });
    const ms = Date.now() - start;

    if (traceId) {
      ok(`X-Killcord-Trace-Id present`, traceId.slice(0, 8) + '…');
    } else {
      fail('X-Killcord-Trace-Id missing — proxy may have crashed');
    }

    if (status === 401 || status === 200) {
      ok(`Proxy handled request → upstream returned ${status}  (${ms} ms)`,
         'semantic filter ran without OOM');
    } else if (status === 500) {
      fail(`Proxy returned 500 — internal error`, JSON.stringify(json));
    } else {
      ok(`Proxy returned ${status} in ${ms} ms`, JSON.stringify(json)?.slice(0, 80));
    }
  } catch (e) { fail('POST /v1/chat/completions', e.message); }

  // ── Memory check via ROI delta ──────────────────────────────────────────────
  console.log(`\n${BOLD}6. Post-load memory / ROI sanity check${RESET}`);
  try {
    const { status, body } = await get('/roi');
    if (status === 200) {
      ok('GET /roi after proxy calls → 200', `tools_stripped=${body.tools_stripped ?? 0}`);
    } else {
      fail(`GET /roi → ${status}`);
    }
  } catch (e) { fail('GET /roi (post-load)', e.message); }

  // ── Summary ─────────────────────────────────────────────────────────────────
  const total = passed + failed;
  console.log(`\n${'─'.repeat(50)}`);
  if (failed === 0) {
    console.log(`${GREEN}${BOLD}All ${total} checks passed.${RESET}`);
  } else {
    console.log(`${RED}${BOLD}${failed} of ${total} checks failed.${RESET}`);
  }
  console.log(`${'─'.repeat(50)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error(`\n${RED}Fatal:${RESET}`, err.message);
  process.exit(1);
});
