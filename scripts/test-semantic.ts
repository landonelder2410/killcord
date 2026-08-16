/**
 * Validates the SHIPPED scanHistoryForSemanticLoop() (not a replica) end-to-end
 * with the real embedder, in both Anthropic and OpenAI message shapes.
 *
 * Run: ./node_modules/.bin/tsx scripts/test-semantic.ts
 */
import { warmup, isEmbedderReady } from '../src/embedder';
import { scanHistoryForSemanticLoop, scanHistoryForLoop } from '../src/circuit-breaker';

const GREEN = '\x1b[32m', RED = '\x1b[31m', BOLD = '\x1b[1m', DIM = '\x1b[2m', RESET = '\x1b[0m';
let pass = 0, fail = 0;

// Anthropic assistant turn with a tool_use block.
function aTurn(name: string, input: unknown) {
  return { role: 'assistant', content: [{ type: 'tool_use', name, input }] };
}
// OpenAI assistant turn with a tool_calls entry (arguments is a JSON string).
function oTurn(name: string, args: unknown) {
  return { role: 'assistant', tool_calls: [{ function: { name, arguments: JSON.stringify(args) } }] };
}

async function expectTrip(label: string, messages: any[], shouldTrip: boolean) {
  const res = await scanHistoryForSemanticLoop(messages);
  const ok = res.tripped === shouldTrip;
  if (ok) {
    pass++;
    console.log(`  ${GREEN}✓${RESET} ${label}  ${DIM}${res.tripped ? `trip @ sim=${res.similarity?.toFixed(3)}` : 'no trip'}${RESET}`);
  } else {
    fail++;
    console.log(`  ${RED}✗ ${label}${RESET}  expected ${shouldTrip ? 'TRIP' : 'no trip'}, got ${res.tripped ? 'TRIP' : 'no trip'}`);
    if (res.detail) console.log(`      ${DIM}${res.detail}${RESET}`);
  }
}

async function main() {
  console.log(`${BOLD}Warming embedder...${RESET}`);
  await warmup();
  console.log(`Embedder ready: ${isEmbedderReady()}\n`);

  console.log(`${BOLD}Anthropic tool_use format${RESET}`);
  // Genuine loop — reworded query each turn. Exact-match MISSES (same name, but
  // exact-match only counts names; here we have 4 same-name so exact WOULD catch
  // at limit 5 — use 4 turns so exact does not trip but semantic does).
  // Queries match the first 4 from scripts/measure-semantic.mjs (proven to trip).
  await expectTrip('reworded search loop (4 turns) → TRIP', [
    aTurn('search_web', { query: 'how to fix docker permission denied error' }),
    aTurn('search_web', { query: 'fixing docker permission denied issue' }),
    aTurn('search_web', { query: 'resolve docker permission denied problem' }),
    aTurn('search_web', { query: 'docker permission denied how do i solve it' }),
  ], true);

  await expectTrip('pagination (5 pages) → no trip', [
    aTurn('list_orders', { page: 1, limit: 50 }),
    aTurn('list_orders', { page: 2, limit: 50 }),
    aTurn('list_orders', { page: 3, limit: 50 }),
    aTurn('list_orders', { page: 4, limit: 50 }),
    aTurn('list_orders', { page: 5, limit: 50 }),
  ], false);

  await expectTrip('distinct-ID lookups → no trip', [
    aTurn('get_user', { id: 'user_1042' }),
    aTurn('get_user', { id: 'user_8891' }),
    aTurn('get_user', { id: 'user_3320' }),
    aTurn('get_user', { id: 'user_7756' }),
  ], false);

  console.log(`\n${BOLD}OpenAI tool_calls format${RESET}`);
  // Tool-rotation loop: the agent keeps searching for the same answer but
  // cycles through different tool names to evade exact-match. This is the
  // core scenario the name-removal from embedStringForCall was designed to catch.
  // Queries are the proven first-4 from scripts/measure-semantic.mjs (trip at call 4).
  await expectTrip('rotating-tool-name loop (4 turns) → TRIP', [
    oTurn('search_web',  { query: 'how to fix docker permission denied error' }),
    oTurn('web_search',  { query: 'fixing docker permission denied issue' }),
    oTurn('lookup_docs', { query: 'resolve docker permission denied problem' }),
    oTurn('find_docs',   { query: 'docker permission denied how do i solve it' }),
  ], true);

  await expectTrip('different-city weather → no trip', [
    oTurn('get_weather', { city: 'Tokyo', units: 'celsius' }),
    oTurn('get_weather', { city: 'London', units: 'celsius' }),
    oTurn('get_weather', { city: 'Paris', units: 'celsius' }),
    oTurn('get_weather', { city: 'Cairo', units: 'celsius' }),
  ], false);

  console.log(`\n${BOLD}Interplay with exact-match${RESET}`);
  // 6 identical calls: exact-match should catch this cheaply (limit 5).
  const identical = Array.from({ length: 6 }, () => aTurn('run_query', { sql: 'SELECT 1' }));
  const exactRes = scanHistoryForLoop(identical);
  if (exactRes.tripped && exactRes.mechanism === 'exact') {
    pass++; console.log(`  ${GREEN}✓${RESET} 6 identical calls caught by exact-match  ${DIM}(${exactRes.reason})${RESET}`);
  } else {
    fail++; console.log(`  ${RED}✗ exact-match should catch 6 identical calls${RESET}`);
  }

  console.log(`\n  ${pass} passed  ${fail > 0 ? RED : ''}${fail} failed${RESET}\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
