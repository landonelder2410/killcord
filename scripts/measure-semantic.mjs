#!/usr/bin/env node
/**
 * Semantic loop detection — measurement harness.
 *
 * Uses the SAME model and embed settings as the production path
 * (Xenova/all-MiniLM-L6-v2, mean pooling, L2 normalized, cosine = dot product).
 *
 * Answers three questions with real numbers:
 *   1. Per-request latency cost of embedding a call history.
 *   2. Does threshold 0.94 cleanly separate genuine loops from legitimate
 *      repeated calls? Prints actual pairwise scores.
 *   3. Where does it fail?
 *
 * Run: node scripts/measure-semantic.mjs
 */
import { pipeline } from '@xenova/transformers';

const THRESHOLD = 0.94;
const WINDOW    = 5;
const REPEATS   = 3;

const RESET = '\x1b[0m', BOLD = '\x1b[1m', GREEN = '\x1b[32m', RED = '\x1b[31m', YEL = '\x1b[33m', DIM = '\x1b[2m';

// ── Model ────────────────────────────────────────────────────────────────────

let embedder;
async function embed(text) {
  const out = await embedder(text.slice(0, 512), { pooling: 'mean', normalize: true });
  return out.data;
}
function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function callString(name, input) {
  return `${name}:${JSON.stringify(input)}`;
}

// ── Replicate scanHistoryForSemanticLoop's decision exactly ─────────────────

function evaluate(vectors) {
  for (let i = REPEATS; i < vectors.length; i++) {
    const start = Math.max(0, i - WINDOW);
    let matches = 0, best = 0, bestJ = -1;
    for (let j = start; j < i; j++) {
      const sc = cosine(vectors[i], vectors[j]);
      if (sc > THRESHOLD) { matches++; if (sc > best) { best = sc; bestJ = j; } }
    }
    if (matches >= REPEATS) return { tripped: true, at: i, matches, best, bestJ };
  }
  return { tripped: false };
}

// ── Test sequences ───────────────────────────────────────────────────────────

const SHOULD_TRIP = [
  {
    name: 'Reworded web search (same intent, rephrased each turn)',
    calls: [
      ['search_web', { query: 'how to fix docker permission denied error' }],
      ['search_web', { query: 'fixing docker permission denied issue' }],
      ['search_web', { query: 'resolve docker permission denied problem' }],
      ['search_web', { query: 'docker permission denied how do i solve it' }],
      ['search_web', { query: 'why does docker say permission denied' }],
    ],
  },
  {
    name: 'Same ticket, reworded title + reordered keys',
    calls: [
      ['create_ticket', { title: 'Login button broken', priority: 'high' }],
      ['create_ticket', { title: 'Login button is broken', priority: 'high' }],
      ['create_ticket', { title: "The login button doesn't work", priority: 'high' }],
      ['create_ticket', { priority: 'high', title: 'Login button not working' }],
      ['create_ticket', { title: 'Fix the broken login button', priority: 'high' }],
    ],
  },
  {
    name: 'Same weather lookup, cosmetic arg variation',
    calls: [
      ['get_weather', { city: 'San Francisco', units: 'celsius' }],
      ['get_weather', { city: 'San Francisco, CA', units: 'celsius' }],
      ['get_weather', { city: 'SF', units: 'celsius' }],
      ['get_weather', { location: 'San Francisco', units: 'celsius' }],
      ['get_weather', { city: 'san francisco', units: 'celsius' }],
    ],
  },
];

const SHOULD_NOT_TRIP = [
  {
    name: 'Pagination (progressing through pages)',
    calls: [
      ['list_orders', { page: 1, limit: 50 }],
      ['list_orders', { page: 2, limit: 50 }],
      ['list_orders', { page: 3, limit: 50 }],
      ['list_orders', { page: 4, limit: 50 }],
      ['list_orders', { page: 5, limit: 50 }],
    ],
  },
  {
    name: 'Different records (batch lookup, distinct IDs)',
    calls: [
      ['get_user', { id: 'user_1042' }],
      ['get_user', { id: 'user_8891' }],
      ['get_user', { id: 'user_3320' }],
      ['get_user', { id: 'user_7756' }],
      ['get_user', { id: 'user_5501' }],
    ],
  },
  {
    name: 'Weather across different cities (legit multi-item)',
    calls: [
      ['get_weather', { city: 'Tokyo', units: 'celsius' }],
      ['get_weather', { city: 'London', units: 'celsius' }],
      ['get_weather', { city: 'Paris', units: 'celsius' }],
      ['get_weather', { city: 'Cairo', units: 'celsius' }],
      ['get_weather', { city: 'Sydney', units: 'celsius' }],
    ],
  },
];

// ── Pretty matrix ────────────────────────────────────────────────────────────

async function analyze(seq) {
  const strs = seq.calls.map(([n, i]) => callString(n, i));
  const vecs = [];
  for (const s of strs) vecs.push(await embed(s));

  console.log(`\n  ${BOLD}${seq.name}${RESET}`);
  for (const s of strs) console.log(`    ${DIM}${s}${RESET}`);

  // Pairwise upper-triangle scores.
  console.log(`    ${DIM}pairwise cosine:${RESET}`);
  let min = 1, max = 0;
  const scores = [];
  for (let i = 0; i < vecs.length; i++) {
    for (let j = i + 1; j < vecs.length; j++) {
      const sc = cosine(vecs[i], vecs[j]);
      scores.push(sc);
      if (sc < min) min = sc;
      if (sc > max) max = sc;
    }
  }
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  // consecutive scores (i vs i+1)
  const consec = [];
  for (let i = 0; i + 1 < vecs.length; i++) consec.push(cosine(vecs[i], vecs[i + 1]));

  console.log(`      consecutive: [${consec.map(s => s.toFixed(3)).join(', ')}]`);
  console.log(`      min=${min.toFixed(3)}  avg=${avg.toFixed(3)}  max=${max.toFixed(3)}`);

  const verdict = evaluate(vecs);
  const label = verdict.tripped
    ? `${YEL}TRIPS${RESET} at call #${verdict.at + 1} (${verdict.matches} matches ≥ ${THRESHOLD}, best=${verdict.best.toFixed(3)} vs #${verdict.bestJ + 1})`
    : `${DIM}no trip${RESET}`;
  console.log(`      → ${label}`);
  return { min, avg, max, tripped: verdict.tripped };
}

// ── Latency ──────────────────────────────────────────────────────────────────

async function measureLatency() {
  console.log(`\n${BOLD}═══ Latency ═══${RESET}`);
  // Realistic history: 15 tool calls (agent 15 turns deep).
  const history = [];
  for (let i = 0; i < 15; i++) history.push(callString('search_web', { query: `topic number ${i} to research in depth` }));

  // Cold: embed all 15 fresh.
  let t0 = performance.now();
  const vecs = [];
  for (const s of history) vecs.push(await embed(s));
  let cold = performance.now() - t0;

  // Warm (cache hit): re-embed the same 15 — simulates LRU cache serving repeats.
  // In production, cached strings are NOT re-embedded; this measures the pure
  // pairwise-cosine cost once vectors are in hand.
  t0 = performance.now();
  for (let i = REPEATS; i < vecs.length; i++)
    for (let j = Math.max(0, i - WINDOW); j < i; j++) cosine(vecs[i], vecs[j]);
  let compareOnly = performance.now() - t0;

  // Single embed (marginal cost of ONE new call when prior calls are cached).
  const single = [];
  for (let k = 0; k < 10; k++) {
    t0 = performance.now();
    await embed(callString('do_thing', { n: k, note: 'a moderately sized argument payload' }));
    single.push(performance.now() - t0);
  }
  single.sort((a, b) => a - b);
  const p50 = single[Math.floor(single.length / 2)];

  console.log(`  Cold embed of 15-call history:  ${BOLD}${cold.toFixed(1)} ms${RESET}  (${(cold / 15).toFixed(1)} ms/call)`);
  console.log(`  Pairwise cosine only (15 calls): ${BOLD}${compareOnly.toFixed(2)} ms${RESET}`);
  console.log(`  Single embed (p50, warm model):  ${BOLD}${p50.toFixed(1)} ms${RESET}`);
  console.log(`  ${DIM}→ Steady state: only the newest 1–2 calls are uncached per request,`);
  console.log(`     so marginal cost ≈ ${p50.toFixed(1)} ms + <0.1 ms compare.${RESET}`);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`${BOLD}Loading MiniLM-L6-v2...${RESET}`);
  const tl = performance.now();
  embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  console.log(`Model ready in ${((performance.now() - tl) / 1000).toFixed(1)}s`);
  console.log(`\nDefaults: threshold=${THRESHOLD} window=${WINDOW} repeats=${REPEATS}`);

  console.log(`\n${BOLD}═══ SHOULD TRIP (genuine loops) ═══${RESET}`);
  const tripStats = [];
  for (const seq of SHOULD_TRIP) tripStats.push(await analyze(seq));

  console.log(`\n${BOLD}═══ SHOULD NOT TRIP (legitimate repeats) ═══${RESET}`);
  const noTripStats = [];
  for (const seq of SHOULD_NOT_TRIP) noTripStats.push(await analyze(seq));

  await measureLatency();

  // ── Separation verdict ─────────────────────────────────────────────────
  console.log(`\n${BOLD}═══ Separation at threshold ${THRESHOLD} ═══${RESET}`);
  const tripCorrect = tripStats.filter(s => s.tripped).length;
  const noTripCorrect = noTripStats.filter(s => !s.tripped).length;
  console.log(`  SHOULD TRIP caught:      ${tripCorrect}/3`);
  console.log(`  SHOULD NOT TRIP passed:  ${noTripCorrect}/3`);

  const maxTripMin = Math.min(...tripStats.map(s => s.avg));
  const maxNoTripAvg = Math.max(...noTripStats.map(s => s.avg));
  console.log(`\n  Lowest avg-similarity among SHOULD-TRIP:     ${maxTripMin.toFixed(3)}`);
  console.log(`  Highest avg-similarity among SHOULD-NOT-TRIP: ${maxNoTripAvg.toFixed(3)}`);
  if (maxNoTripAvg >= maxTripMin) {
    console.log(`  ${RED}${BOLD}OVERLAP: legitimate repeats score as high or higher than genuine loops.${RESET}`);
    console.log(`  ${RED}A single global cosine threshold cannot separate these cleanly.${RESET}`);
  } else {
    console.log(`  ${GREEN}Clean separation — a threshold exists between the two classes.${RESET}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
