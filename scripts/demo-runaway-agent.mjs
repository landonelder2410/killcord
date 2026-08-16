#!/usr/bin/env node
/**
 * Killcord — Runaway Agent Demo
 *
 * Simulates an agent that rephrases its tool arguments each turn so that
 * exact-match cannot stop it. Shows exactly when each detection mechanism fires,
 * how many tokens each scenario would have burned, and prints the final 429 body.
 *
 * Requires no API key and no running proxy. Uses the same model and logic as the
 * production semantic circuit-breaker (Xenova/all-MiniLM-L6-v2 + NL-content
 * extraction).
 *
 * Run:
 *   npx tsx scripts/demo-runaway-agent.mjs
 *
 * Output is copy-pasteable into a GitHub comment.
 */
import { pipeline } from '@xenova/transformers';

// ── Config (mirrors production defaults) ────────────────────────────────────

const EXACT_LIMIT  = 5;     // CB_TOOL_REPEAT_LIMIT
const SEM_THRESH   = 0.94;  // KILLCORD_SEMANTIC_THRESHOLD
const SEM_WINDOW   = 5;     // KILLCORD_SEMANTIC_WINDOW
const SEM_REPEATS  = 3;     // KILLCORD_SEMANTIC_REPEATS

// Rough token estimate per agent turn (user prompt + assistant reply + tool call).
// Based on a typical 2048-token context growing by ~200 tokens/turn.
const TOKENS_PER_TURN = 200;

const RESET='\x1b[0m',BOLD='\x1b[1m',GREEN='\x1b[32m',RED='\x1b[31m',
      YEL='\x1b[33m',DIM='\x1b[2m',CYAN='\x1b[36m';

// ── Model ────────────────────────────────────────────────────────────────────

let embedder;
async function embed(t){
  const out = await embedder(t.slice(0, 512), { pooling: 'mean', normalize: true });
  return out.data;
}
function cosine(a, b){ let s=0; for(let i=0;i<a.length;i++) s+=a[i]*b[i]; return s; }

// ── NL-content extraction (mirrors src/circuit-breaker.ts) ──────────────────

function isNL(v){
  return typeof v === 'string' && ((/\s/.test(v) && v.length >= 8) || v.length >= 25);
}
function semanticContent(name, input){
  const parts = [];
  const walk = (v) => {
    if (isNL(v)) parts.push(v);
    else if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k]);
  };
  walk(input);
  return parts.length ? `${name}: ${parts.join(' ')}` : null;
}

// ── Exact-match check (mirrors scanHistoryForLoop) ──────────────────────────

function checkExact(calls){
  const counts = {};
  for (const [name] of calls) counts[name] = (counts[name] ?? 0) + 1;
  for (const [name, n] of Object.entries(counts)){
    if (n > EXACT_LIMIT) return { tripped: true, name, count: n };
  }
  return { tripped: false };
}

// ── Semantic check (mirrors scanHistoryForSemanticLoop + NL extraction) ──────

async function checkSemantic(calls){
  const contents = calls.map(([n,i]) => semanticContent(n, i));
  const vecs = [];
  for (const c of contents) vecs.push(c === null ? null : await embed(c));

  const idxs = vecs.map((v,i) => v !== null ? i : -1).filter(i => i >= 0);

  for (let p = SEM_REPEATS; p < idxs.length; p++){
    const i = idxs[p];
    const start = Math.max(0, p - SEM_WINDOW);
    let matches = 0, best = 0, bestIdx = -1;
    for (let q = start; q < p; q++){
      const j = idxs[q];
      const sc = cosine(vecs[i], vecs[j]);
      if (sc > SEM_THRESH){ matches++; if (sc > best){ best = sc; bestIdx = j; } }
    }
    if (matches >= SEM_REPEATS){
      return { tripped: true, at: i, matches, similarity: best, comparedTo: bestIdx };
    }
  }
  return { tripped: false };
}

// ── Scenario definition ───────────────────────────────────────────────────────
//
// The agent is tasked with "fix the Docker permission denied error." It keeps
// calling search_web with slightly different phrasing each turn — a classic
// rephrased loop. Exact-match sees the same tool name, but counts to 5 before
// it fires; semantic sees the meaning and fires much earlier.

const AGENT_TURNS = [
  ['search_web', { query: 'how to fix docker permission denied error' }],
  ['search_web', { query: 'fixing docker permission denied issue' }],
  ['search_web', { query: 'resolve docker permission denied problem' }],
  ['search_web', { query: 'docker permission denied how do i solve it' }],
  ['search_web', { query: 'why does docker say permission denied' }],
  ['search_web', { query: 'docker cannot access file permission denied fix' }],
  ['search_web', { query: 'docker permission error troubleshooting guide' }],
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(){
  console.log(`\n${BOLD}${'═'.repeat(62)}${RESET}`);
  console.log(`${BOLD}  Killcord — Runaway Agent Demo${RESET}`);
  console.log(`${BOLD}${'═'.repeat(62)}${RESET}`);
  console.log(`
  Scenario: an agent tasked with fixing a Docker error. It rephrases
  its search query each turn so that exact-match (which only counts
  how many times a tool name appears) cannot stop it.

  Exact-match limit : CB_TOOL_REPEAT_LIMIT = ${EXACT_LIMIT} (fires after ${EXACT_LIMIT + 1} calls)
  Semantic threshold: ${SEM_THRESH}  window: ${SEM_WINDOW}  repeats: ${SEM_REPEATS}
`);

  console.log(`${BOLD}Loading MiniLM-L6-v2...${RESET}  ${DIM}(same model as production)${RESET}`);
  const t0 = performance.now();
  embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  console.log(`Model ready in ${((performance.now()-t0)/1000).toFixed(1)}s\n`);

  console.log(`${BOLD}── Turn-by-turn simulation ──${RESET}\n`);

  let exactTripAt = null;
  let semanticTripAt = null;
  let semanticResult = null;

  const history = [];
  for (let t = 0; t < AGENT_TURNS.length; t++){
    const turn = AGENT_TURNS[t];
    history.push(turn);

    const exact = checkExact(history);
    const sem   = await checkSemantic(history);

    const turnN = t + 1;
    const tokens = turnN * TOKENS_PER_TURN;

    let status;
    if (sem.tripped && !semanticTripAt){
      semanticTripAt = turnN;
      semanticResult = sem;
      status = `${YEL}⚠ SEMANTIC TRIP${RESET}`;
    } else if (exact.tripped && !exactTripAt){
      exactTripAt = turnN;
      status = `${RED}✗ EXACT-MATCH TRIP${RESET}`;
    } else if (semanticTripAt || exactTripAt){
      status = `${DIM}(already tripped)${RESET}`;
    } else {
      status = `${GREEN}ok${RESET}`;
    }

    const [name, input] = turn;
    const qTrunc = input.query.length > 48 ? input.query.slice(0,45)+'…' : input.query;
    console.log(
      `  Turn ${String(turnN).padEnd(2)}  ${CYAN}${name}${RESET}` +
      `  ${DIM}{ query: "${qTrunc}" }${RESET}\n` +
      `           → ${status}  ${DIM}~${tokens} tokens burned${RESET}`
    );
    console.log();

    // Stop after both have tripped (or we've run all turns)
    if (semanticTripAt && exactTripAt) break;
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  const exactTripsAt  = exactTripAt   ?? `never (would need ${EXACT_LIMIT + 1} calls)`;
  const semTripsAt    = semanticTripAt ?? 'never';
  const exactTokens   = exactTripAt   ? exactTripAt   * TOKENS_PER_TURN : (AGENT_TURNS.length * TOKENS_PER_TURN) + '+';
  const semTokens     = semanticTripAt ? semanticTripAt * TOKENS_PER_TURN : 'unlimited';
  const savedTurns    = exactTripAt && semanticTripAt
    ? exactTripAt - semanticTripAt
    : null;
  const savedTokens   = savedTurns !== null ? savedTurns * TOKENS_PER_TURN : null;

  console.log(`${BOLD}── Results ──${RESET}\n`);
  console.log(`  Exact-match trips at : ${exactTripAt ? `turn ${exactTripAt}  (~${exactTokens} tokens)` : exactTripsAt}`);
  console.log(`  Semantic trips at    : turn ${semTripsAt}  (~${semTokens} tokens)`);
  if (savedTurns !== null && savedTurns > 0){
    console.log(`\n  ${GREEN}${BOLD}Semantic caught it ${savedTurns} turn(s) earlier — ~${savedTokens} tokens intercepted.${RESET}`);
  }

  // ── 429 body ─────────────────────────────────────────────────────────────

  if (semanticResult){
    const sim = semanticResult.similarity;
    const at  = semanticResult.at + 1;        // 1-indexed
    const cmp = semanticResult.comparedTo + 1;
    const [toolName] = AGENT_TURNS[semanticResult.at];

    const body429 = {
      error:       'circuit_breaker_tripped',
      reason:      'semantic_loop',
      mechanism:   'semantic',
      similarity:  Math.round(sim * 1000) / 1000,
      detail:      `Tool call #${at} ("${toolName}") is ${(sim*100).toFixed(1)}% semantically similar to ${semanticResult.matches} of the previous ${Math.min(SEM_WINDOW, at-1)} calls. Threshold: ${SEM_THRESH}.`,
      retry_after: 60,
    };

    console.log(`\n${BOLD}── Final 429 body ──${RESET}\n`);
    console.log(JSON.stringify(body429, null, 2).split('\n').map(l => '  ' + l).join('\n'));
  }

  console.log(`\n${BOLD}── Reproduce the measurement ──${RESET}
  ${DIM}# Shows raw cosine scores and why naive embedding fails:${RESET}
  node scripts/measure-semantic.mjs

  ${DIM}# Shows 6/6 clean separation with NL-content extraction:${RESET}
  node scripts/measure-semantic-fix.mjs
`);
}

main().catch(e => { console.error(e); process.exit(1); });
