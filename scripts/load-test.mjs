#!/usr/bin/env node
/**
 * Killcord — autocannon load test
 *
 * Fires 50 concurrent connections for 10 seconds at /v1/chat/completions
 * and reports avg req/sec, p99 latency, 2xx count, and 429 count.
 *
 * Usage:
 *   node scripts/load-test.mjs [host]
 *
 * host defaults to http://localhost:3000
 * Make sure the proxy is running before starting this script.
 */

import { createRequire } from 'node:module';

const require     = createRequire(import.meta.url);
const autocannon  = require('autocannon');

const HOST = process.argv.find(a => a.startsWith('http')) ?? 'http://localhost:3000';

const PAYLOAD = JSON.stringify({
  model:    'gpt-4o',
  messages: [
    { role: 'user', content: 'Summarize the latest quarterly earnings report.' },
  ],
  tools: [
    {
      type:     'function',
      function: {
        name:        'fetch_report',
        description: 'Fetches a financial report by ticker symbol and quarter.',
        parameters:  {
          type:       'object',
          properties: { ticker: { type: 'string' }, quarter: { type: 'string' } },
          required:   ['ticker', 'quarter'],
        },
      },
    },
    {
      type:     'function',
      function: {
        name:        'summarize_document',
        description: 'Summarizes a long document into bullet points.',
        parameters:  {
          type:       'object',
          properties: { text: { type: 'string' }, max_bullets: { type: 'number' } },
          required:   ['text'],
        },
      },
    },
  ],
});

console.log(`\nKillcord load test`);
console.log(`  target      : ${HOST}/v1/chat/completions`);
console.log(`  connections : 50`);
console.log(`  duration    : 10s`);
console.log(`  body        : ${PAYLOAD.length} bytes\n`);

const instance = autocannon({
  url:         `${HOST}/v1/chat/completions`,
  connections: 50,
  duration:    10,
  method:      'POST',
  headers: {
    'content-type':        'application/json',
    'x-killcord-session-id': `load-test-${Date.now()}`,
  },
  body: PAYLOAD,
}, (err, result) => {
  if (err) {
    console.error('Load test error:', err);
    process.exit(1);
  }

  const avgRps   = result.requests.average;
  const p99      = result.latency.p99;
  const ok2xx    = Object.entries(result.statusCodeStats ?? {})
    .filter(([code]) => code.startsWith('2'))
    .reduce((s, [, v]) => s + (v.count ?? 0), 0);
  const rate429  = (result.statusCodeStats?.['429']?.count ?? 0);

  console.log('── Results ──────────────────────────────');
  console.log(`  avg req/sec : ${avgRps.toFixed(1)}`);
  console.log(`  p99 latency : ${p99} ms`);
  console.log(`  2xx count   : ${ok2xx}`);
  console.log(`  429 count   : ${rate429}`);
  console.log('─────────────────────────────────────────\n');
});

autocannon.track(instance, { renderProgressBar: true });
