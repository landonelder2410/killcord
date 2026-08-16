#!/usr/bin/env node
/**
 * Killcord — Runaway Agent Demo
 *
 * Two scenarios that show when and why exact-match fails and semantic catches:
 *
 *   Scenario 1 — Same tool name, rephrased args each turn.
 *                Exact-match would catch at turn 6 (name count > limit=5).
 *                Semantic catches at turn 4.  Saves 2 turns.
 *
 *   Scenario 2 — Rotating tool names + rephrased args.  The agent uses 10
 *                different tool names so no single name ever exceeds
 *                CB_TOOL_REPEAT_LIMIT=5.  Exact-match NEVER fires across
 *                40 turns.  Semantic still catches at turn 4.
 *
 * Token estimate formula (stated explicitly, not invented):
 *   - Base context (system prompt + initial user msg): 500 tokens (constant)
 *   - Per-turn growth: 100 tokens (tool_call JSON + tool_result + follow-up)
 *   - Input tokens at turn N: 500 + 100 × (N − 1)
 *   - Cumulative over M turns: M×500 + 100×M×(M−1)/2
 *
 * Pricing: Claude Sonnet 3.5 input rate $3.00 / 1 000 000 tokens (as of 2026).
 * Output tokens not included — only input tokens reach the proxy.
 *
 * Runs standalone: no API key, no running proxy.  Uses the same model and
 * NL-extraction logic as the production circuit-breaker.
 *
 * Run:
 *   npx tsx scripts/demo-runaway-agent.mjs
 *
 * Output is copy-pasteable into a GitHub comment.
 */
import { pipeline } from '@xenova/transformers';

// ── Config (mirrors production defaults) ─────────────────────────────────────

const EXACT_LIMIT = 5;   // CB_TOOL_REPEAT_LIMIT
const SEM_THRESH  = 0.94; // KILLCORD_SEMANTIC_THRESHOLD
const SEM_WINDOW  = 5;   // KILLCORD_SEMANTIC_WINDOW
const SEM_REPEATS = 3;   // KILLCORD_SEMANTIC_REPEATS

// Token estimate constants (see file header for formula).
const BASE_TOKENS       = 500;  // constant context (system prompt + first user msg)
const PER_TURN_GROWTH   = 100;  // tokens added to context per turn
const PRICE_PER_MTOK    = 3.00; // USD per 1 000 000 input tokens (Claude Sonnet 3.5)

function cumulativeTokens(turns) {
  // sum(i=1..turns, BASE + PER_TURN_GROWTH × (i-1))
  // = turns × BASE + PER_TURN_GROWTH × turns × (turns-1) / 2
  return turns * BASE_TOKENS + PER_TURN_GROWTH * turns * (turns - 1) / 2;
}
function usd(tokens) {
  return (tokens / 1_000_000 * PRICE_PER_MTOK).toFixed(6);
}

const RESET='\x1b[0m',BOLD='\x1b[1m',GREEN='\x1b[32m',RED='\x1b[31m',
      YEL='\x1b[33m',DIM='\x1b[2m',CYAN='\x1b[36m';

// ── Model ─────────────────────────────────────────────────────────────────────

let embedder;
async function embed(t) {
  const out = await embedder(t.slice(0, 512), { pooling: 'mean', normalize: true });
  return out.data;
}
function cosine(a, b) { let s=0; for (let i=0; i<a.length; i++) s+=a[i]*b[i]; return s; }

// ── NL-content extraction (mirrors src/circuit-breaker.ts) ───────────────────

function isNL(v) {
  return typeof v === 'string' && ((/\s/.test(v) && v.length >= 8) || v.length >= 25);
}
function semanticContent(_name, input) {
  // Tool name intentionally excluded — semantic detection catches same-intent
  // loops regardless of which tool is called. Exact-match already tracks names.
  const parts = [];
  const walk = (v) => {
    if (isNL(v)) parts.push(v);
    else if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k]);
  };
  walk(input);
  return parts.length ? parts.join(' ') : null;
}

// ── Exact-match check (mirrors scanHistoryForLoop) ───────────────────────────

function checkExact(calls) {
  const counts = {};
  for (const [name] of calls) counts[name] = (counts[name] ?? 0) + 1;
  for (const [name, n] of Object.entries(counts)) {
    if (n > EXACT_LIMIT) return { tripped: true, name, count: n };
  }
  return { tripped: false, maxCount: Math.max(0, ...Object.values(counts)) };
}

// ── Semantic check (mirrors scanHistoryForSemanticLoop + NL extraction) ───────

async function checkSemantic(calls) {
  const contents = calls.map(([n,i]) => semanticContent(n, i));
  const vecs = [];
  for (const c of contents) vecs.push(c === null ? null : await embed(c));
  const idxs = vecs.map((v,i) => v !== null ? i : -1).filter(i => i >= 0);

  for (let p = SEM_REPEATS; p < idxs.length; p++) {
    const i = idxs[p];
    const start = Math.max(0, p - SEM_WINDOW);
    let matches = 0, best = 0, bestIdx = -1;
    for (let q = start; q < p; q++) {
      const j = idxs[q];
      const sc = cosine(vecs[i], vecs[j]);
      if (sc > SEM_THRESH) { matches++; if (sc > best) { best = sc; bestIdx = j; } }
    }
    if (matches >= SEM_REPEATS) {
      return { tripped: true, at: i, matches, similarity: best, comparedTo: bestIdx };
    }
  }
  return { tripped: false };
}

// ── Scenario runner ───────────────────────────────────────────────────────────

async function runScenario(label, turns, maxTurns) {
  console.log(`\n${BOLD}${label}${RESET}`);
  console.log(`${'─'.repeat(60)}`);

  const history = [];
  let exactTripAt   = null;
  let semanticTripAt = null;
  let semanticResult = null;

  for (let t = 0; t < maxTurns && t < turns.length; t++) {
    const turn = turns[t];
    history.push(turn);

    const exact = checkExact(history);
    const sem   = await checkSemantic(history);
    const turnN = t + 1;

    if (!exactTripAt   && exact.tripped)   exactTripAt = turnN;
    if (!semanticTripAt && sem.tripped) { semanticTripAt = turnN; semanticResult = sem; }

    // Print first 6 turns or any turn that causes a trip
    const shouldPrint = turnN <= 6 || exact.tripped || sem.tripped;
    if (shouldPrint) {
      const [name, input] = turn;
      const q = (input.query ?? '').length > 44
        ? (input.query ?? '').slice(0, 41) + '…'
        : (input.query ?? '');

      let status;
      if (sem.tripped && semanticTripAt === turnN) {
        status = `${YEL}⚠ SEMANTIC TRIP (sim=${sem.similarity.toFixed(3)})${RESET}`;
      } else if (exact.tripped && exactTripAt === turnN) {
        status = `${RED}✗ EXACT-MATCH TRIP${RESET}`;
      } else if (semanticTripAt || exactTripAt) {
        status = `${DIM}(already tripped)${RESET}`;
      } else {
        status = `${GREEN}ok${RESET}`;
      }
      const pad = (s, n) => s.padEnd(n);
      console.log(`  Turn ${String(turnN).padEnd(3)} ${CYAN}${pad(name, 16)}${RESET} "${q}" → ${status}`);
    } else if (turnN === 7 && maxTurns > 6) {
      console.log(`  ${DIM}… (${maxTurns - 6} more turns run; printing only trips below)${RESET}`);
    }

    // Stop early once both have tripped
    if (exactTripAt && semanticTripAt) break;
  }

  return { exactTripAt, semanticTripAt, semanticResult, history };
}

// ── Build-429 helper ─────────────────────────────────────────────────────────

function format429(turns, result) {
  if (!result) return null;
  const [toolName] = turns[result.at];
  const at  = result.at + 1;
  const sim = result.similarity;
  return {
    error:       'circuit_breaker_tripped',
    reason:      'semantic_loop',
    mechanism:   'semantic',
    similarity:  Math.round(sim * 1000) / 1000,
    detail:      `Tool call #${at} ("${toolName}") is ${(sim*100).toFixed(1)}% semantically similar to ${result.matches} of the previous ${Math.min(SEM_WINDOW, at-1)} calls. Threshold: ${SEM_THRESH}.`,
    retry_after: 60,
  };
}

// ── Scenario definitions ──────────────────────────────────────────────────────

// Scenario 1: same tool name, rephrased queries.
const S1_TURNS = [
  ['search_web', { query: 'how to fix docker permission denied error' }],
  ['search_web', { query: 'fixing docker permission denied issue' }],
  ['search_web', { query: 'resolve docker permission denied problem' }],
  ['search_web', { query: 'docker permission denied how do i solve it' }],
  ['search_web', { query: 'why does docker say permission denied' }],
  ['search_web', { query: 'docker cannot access file permission denied fix' }],
  ['search_web', { query: 'docker permission error troubleshooting guide' }],
];

// Scenario 2: 10 rotating tool names + rephrased queries.
// 40 turns ÷ 10 names = 4 appearances each. 4 < CB_TOOL_REPEAT_LIMIT (5),
// so exact-match never fires regardless of how long this runs.
const TOOL_NAMES = [
  'search_web', 'web_search', 'lookup_docs', 'find_docs',
  'query_index', 'browse_web', 'search_index', 'docs_lookup',
  'web_lookup', 'search_kb',
];
const QUERIES = [
  'how to fix docker permission denied error',
  'fixing docker permission denied issue',
  'resolve docker permission denied problem',
  'docker permission denied how do i solve it',
  'why does docker say permission denied',
  'docker cannot access file permission denied fix',
  'docker permission error troubleshooting guide',
  'docker run permission denied workaround',
  'solve docker permission denied on linux',
  'permission denied docker socket fix',
];
const S2_TURNS = Array.from({ length: 40 }, (_, i) => [
  TOOL_NAMES[i % TOOL_NAMES.length],
  { query: QUERIES[i % QUERIES.length] },
]);

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${BOLD}${'═'.repeat(62)}${RESET}`);
  console.log(`${BOLD}  Killcord — Runaway Agent Demo${RESET}`);
  console.log(`${BOLD}${'═'.repeat(62)}${RESET}`);
  console.log(`
  Scenario: agent is stuck trying to fix a Docker permission error.
  It keeps searching with slightly different phrasing each turn.

  Exact-match (CB_TOOL_REPEAT_LIMIT=${EXACT_LIMIT}): counts identical tool NAMES.
  Semantic  (threshold=${SEM_THRESH}, window=${SEM_WINDOW}, repeats=${SEM_REPEATS}):
    embeds NL content; trips when ${SEM_REPEATS}+ of last ${SEM_WINDOW} calls are similar.

  Token estimate: ${BASE_TOKENS} base + ${PER_TURN_GROWTH}×(turn−1) input tokens per request.
  Price: $${PRICE_PER_MTOK.toFixed(2)} / Mtok (Claude Sonnet 3.5 input, as of 2026).
`);

  console.log(`${BOLD}Loading MiniLM-L6-v2...${RESET}  ${DIM}(same model as production)${RESET}`);
  const t0 = performance.now();
  embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  console.log(`Model ready in ${((performance.now()-t0)/1000).toFixed(1)}s`);

  // ── Run both scenarios ────────────────────────────────────────────────────

  const r1 = await runScenario(
    'Scenario 1 — Same tool name, rephrased args (exact-match fires at turn 6)',
    S1_TURNS, S1_TURNS.length,
  );

  const r2 = await runScenario(
    'Scenario 2 — 10 rotating tool names, rephrased args (exact-match NEVER fires)',
    S2_TURNS, 40,
  );

  // ── Side-by-side comparison ───────────────────────────────────────────────

  const S2_MAX = 40;
  const s1ExactTok = r1.exactTripAt   ? cumulativeTokens(r1.exactTripAt)   : cumulativeTokens(S2_MAX);
  const s1SemTok   = r1.semanticTripAt ? cumulativeTokens(r1.semanticTripAt) : cumulativeTokens(S2_MAX);
  const s2ExactTok = cumulativeTokens(S2_MAX); // never trips in 40 turns
  const s2SemTok   = r2.semanticTripAt ? cumulativeTokens(r2.semanticTripAt) : cumulativeTokens(S2_MAX);

  const s1ExactStr = r1.exactTripAt   ? `turn ${r1.exactTripAt}`   : 'never (> 40 turns)';
  const s2ExactStr = 'never (max name count: 4, limit: 5)';

  console.log(`\n${BOLD}${'═'.repeat(62)}${RESET}`);
  console.log(`${BOLD}  Comparison${RESET}`);
  console.log(`${BOLD}${'═'.repeat(62)}${RESET}`);

  // Markdown table — copy-pasteable into a GitHub comment
  const table = `
| | Scenario 1<br>same tool name | Scenario 2<br>10 rotating names |
|---|---|---|
| **Exact-match trips at** | ${s1ExactStr} | ${s2ExactStr} |
| **Semantic trips at** | turn ${r1.semanticTripAt ?? '?'} | turn ${r2.semanticTripAt ?? '?'} |
| **Tokens if exact-match only** | ${s1ExactTok.toLocaleString()} | ${s2ExactTok.toLocaleString()} (uncapped) |
| **Tokens with semantic** | ${s1SemTok.toLocaleString()} | ${s2SemTok.toLocaleString()} |
| **USD if exact-match only** | $${usd(s1ExactTok)} | $${usd(s2ExactTok)} |
| **USD with semantic** | $${usd(s1SemTok)} | $${usd(s2SemTok)} |
| **USD saved** | $${usd(s1ExactTok - s1SemTok)} | $${usd(s2ExactTok - s2SemTok)} |
`;

  console.log(table);
  console.log(`  ${DIM}Token formula: ${BASE_TOKENS} + ${PER_TURN_GROWTH}×(turn−1) per request, cumulative.${RESET}`);
  console.log(`  ${DIM}$${PRICE_PER_MTOK.toFixed(2)}/Mtok = Claude Sonnet 3.5 input pricing as of 2026.${RESET}`);
  console.log(`  ${DIM}Output tokens not counted — only input tokens reach the proxy.${RESET}`);

  // ── 429 body for Scenario 2 ───────────────────────────────────────────────

  const body429 = format429(S2_TURNS, r2.semanticResult);
  if (body429) {
    console.log(`\n${BOLD}Final 429 body (Scenario 2)${RESET}\n`);
    console.log(JSON.stringify(body429, null, 2).split('\n').map(l => '  ' + l).join('\n'));
  }

  // ── GitHub comment block ──────────────────────────────────────────────────

  console.log(`\n${BOLD}${'═'.repeat(62)}${RESET}`);
  console.log(`${BOLD}  Copy-paste block for GitHub${RESET}`);
  console.log(`${BOLD}${'═'.repeat(62)}${RESET}\n`);

  const ghBlock = `### Killcord demo: semantic loop detection
${table}
<details>
<summary>429 body (Scenario 2)</summary>

\`\`\`json
${JSON.stringify(body429, null, 2)}
\`\`\`
</details>

<sub>
Token estimate: ${BASE_TOKENS} base + ${PER_TURN_GROWTH}×(turn−1) input tokens per request, cumulative.
$${PRICE_PER_MTOK.toFixed(2)}/Mtok = Claude Sonnet 3.5 input pricing as of 2026. Output tokens not counted.
Reproduce: \`npx tsx scripts/demo-runaway-agent.mjs\`
</sub>`;

  console.log(ghBlock);

  console.log(`\n${BOLD}── Reproduce the measurements ──${RESET}
  ${DIM}# Why naive JSON embedding fails (overlap table):${RESET}
  node scripts/measure-semantic.mjs

  ${DIM}# 6/6 clean separation with NL-content extraction:${RESET}
  node scripts/measure-semantic-fix.mjs
`);
}

main().catch(e => { console.error(e); process.exit(1); });
