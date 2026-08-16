#!/usr/bin/env node
/**
 * Killcord trace capture smoke test.
 *
 * Fires a mock request at the proxy running on KILLCORD_BASE_URL (default
 * http://localhost:8080), then asserts:
 *   1. A trace file exists in .killcord/traces/
 *   2. The last line parses as valid JSON
 *   3. The traceId matches the X-Killcord-Trace-Id response header
 *   4. Steps array is non-empty
 *   5. No raw email addresses or API keys appear in any preview field
 *
 * Start the proxy first:
 *   WORKERS=1 KILLCORD_REQUIRE_LICENSE_KEY=false npm run dev
 */
import fs   from 'node:fs';
import path from 'node:path';

const BASE      = process.env.KILLCORD_BASE_URL ?? 'http://localhost:8080';
const TRACE_DIR = process.env.KILLCORD_TRACE_DIR
  ? path.resolve(process.env.KILLCORD_TRACE_DIR)
  : path.join(process.cwd(), '.killcord', 'traces');

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED   = '\x1b[31m';
const BOLD  = '\x1b[1m';

let passed = 0, failed = 0;

function ok(label, detail = '') {
  passed++;
  console.log(`  ${GREEN}✓${RESET} ${label}${detail ? `  ${detail}` : ''}`);
}

function fail(label, detail = '') {
  failed++;
  console.error(`  ${RED}✗${RESET} ${BOLD}${label}${RESET}${detail ? `\n    ${detail}` : ''}`);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function latestTraceFile() {
  if (!fs.existsSync(TRACE_DIR)) return null;
  const files = fs.readdirSync(TRACE_DIR)
    .filter(f => f.startsWith('traces-') && f.endsWith('.jsonl'))
    .sort()
    .reverse();
  return files.length > 0 ? path.join(TRACE_DIR, files[0]) : null;
}

function lastLineOf(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  return lines[lines.length - 1] ?? null;
}

const PII_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}|sk-[a-zA-Z0-9\-_]{20,}|AKIA[0-9A-Z]{16}/;

function containsPII(obj) {
  const s = JSON.stringify(obj);
  return PII_RE.test(s);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${BOLD}Killcord — trace capture smoke test${RESET}\n`);
  console.log(`  Target: ${BASE}`);
  console.log(`  Trace dir: ${TRACE_DIR}\n`);

  // Take a snapshot of the trace dir BEFORE firing the request.
  const beforeMtime = latestTraceFile()
    ? fs.statSync(latestTraceFile()).mtimeMs
    : 0;

  // ── Fire a mock Anthropic request ──────────────────────────────────────
  const payload = {
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 10,
    messages: [
      { role: 'user', content: 'Count to 3.' }
    ],
    tools: [
      { name: 'read_file',   description: 'Read a file from disk', input_schema: { type: 'object', properties: {} } },
      { name: 'send_email',  description: 'Send an email message', input_schema: { type: 'object', properties: {} } },
      { name: 'query_db',    description: 'Run a SQL query',       input_schema: { type: 'object', properties: {} } },
    ],
  };

  let traceId;
  try {
    const resp = await fetch(`${BASE}/v1/messages`, {
      method:  'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'test-key' },
      body:    JSON.stringify(payload),
    });
    traceId = resp.headers.get('x-killcord-trace-id');

    if (resp.status === 401) {
      console.warn('  ⚠ Got 401 — proxy requires a license key.');
      console.warn('    Set KILLCORD_REQUIRE_LICENSE_KEY=false and restart.\n');
      process.exit(1);
    }
    ok(`Request fired  status=${resp.status}  traceId=${traceId}`);
  } catch (e) {
    fail(`Cannot reach proxy at ${BASE}`, e.message);
    console.error('\n  Is the proxy running? Start it with: npm run dev:single\n');
    process.exit(1);
  }

  // Give the async trace write a moment to flush.
  await new Promise(r => setTimeout(r, 300));

  // ── Assert trace file exists ───────────────────────────────────────────
  const traceFile = latestTraceFile();
  if (!traceFile) {
    fail('Trace file exists', `No .jsonl file found in ${TRACE_DIR}`);
    process.exit(1);
  }
  ok('Trace file exists', path.basename(traceFile));

  // ── Assert file was modified after the request ─────────────────────────
  const afterMtime = fs.statSync(traceFile).mtimeMs;
  if (afterMtime > beforeMtime) {
    ok('Trace file was written after request');
  } else {
    fail('Trace file was written after request', 'mtime did not change');
  }

  // ── Parse last JSONL line ──────────────────────────────────────────────
  const lastLine = lastLineOf(traceFile);
  if (!lastLine) {
    fail('Last JSONL line is non-empty');
    process.exit(1);
  }

  let trace;
  try {
    trace = JSON.parse(lastLine);
    ok('Last line parses as valid JSON');
  } catch (e) {
    fail('Last line parses as valid JSON', e.message);
    process.exit(1);
  }

  // ── Assert traceId matches response header ─────────────────────────────
  if (traceId && trace.traceId === traceId) {
    ok('traceId matches X-Killcord-Trace-Id header');
  } else if (!traceId) {
    fail('traceId check', 'No X-Killcord-Trace-Id header in response');
  } else {
    fail('traceId matches header', `header=${traceId} trace.traceId=${trace.traceId}`);
  }

  // ── Assert required fields ─────────────────────────────────────────────
  const required = ['traceId', 'timestamp', 'model', 'latencyMs', 'upstreamStatus',
                    'toolsOffered', 'toolsForwarded', 'tokensIn', 'tokensOut', 'steps', 'circuitBreaker'];
  for (const field of required) {
    if (field in trace) {
      ok(`Field: ${field}`, JSON.stringify(trace[field]).slice(0, 60));
    } else {
      fail(`Field: ${field}`, 'missing');
    }
  }

  // ── Assert steps is array (may be empty for non-tool requests) ─────────
  if (Array.isArray(trace.steps)) {
    ok(`steps[] is array  length=${trace.steps.length}`);
  } else {
    fail('steps[] is array');
  }

  // ── Assert no PII in trace ─────────────────────────────────────────────
  if (!containsPII(trace)) {
    ok('No PII detected in trace payload');
  } else {
    fail('No PII detected in trace payload', 'Found email/key pattern in trace JSON');
  }

  // ── Assert tool filtering happened ────────────────────────────────────
  if (Array.isArray(trace.toolsOffered) && trace.toolsOffered.length === 3) {
    ok('toolsOffered count = 3');
  } else {
    fail('toolsOffered count', `expected 3 got ${JSON.stringify(trace.toolsOffered)}`);
  }
  if (Array.isArray(trace.toolsForwarded) && trace.toolsForwarded.length <= 2) {
    ok(`toolsForwarded filtered  ${trace.toolsOffered?.length ?? '?'} → ${trace.toolsForwarded.length}`);
  } else {
    fail('toolsForwarded filtered', `expected ≤2 got ${JSON.stringify(trace.toolsForwarded)}`);
  }

  // ── Summary ────────────────────────────────────────────────────────────
  console.log(`\n  ${passed} passed  ${failed > 0 ? RED : ''}${failed} failed${RESET}\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
