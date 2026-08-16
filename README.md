# killcord

Stop your agents from burning tokens in infinite loops.

## The problem

AI agents that use tools can get stuck. One call to `search_web` becomes six — same intent, different wording each turn — while you burn tokens and accumulate latency. `max_iterations` is a blunt cap; it can't tell a stuck loop from productive work, so it either cuts runs short or lets loops run long.

Killcord is a local proxy between your agent and its LLM API. It watches every tool call, trips a circuit breaker the moment it detects a loop, and returns a structured 429 your agent can act on — before the fifth wasted round-trip.

## Install

```bash
npm install -g killcord
```

Or run from source:

```bash
git clone https://github.com/landonelder2410/killcord
cd killcord
cp .env.example .env   # edit ANTHROPIC_UPSTREAM and/or OPENAI_UPSTREAM
npm install
npm run dev            # proxy starts on :8080
```

Point your agent at `http://localhost:8080` instead of `https://api.anthropic.com` or `https://api.openai.com`. No other changes required.

## 30-second quickstart

```bash
# Clone and start the proxy
git clone https://github.com/landonelder2410/killcord && cd killcord
cp .env.example .env
npm install && npm run dev

# In another terminal: run the public demo (no API key needed)
npx tsx scripts/demo-runaway-agent.mjs

# Inspect captured traces
killcord replay
```

## Why not just `max_iterations`?

`max_iterations=20` stops your agent after 20 turns regardless of what it's doing — it penalises good runs as much as bad ones. Killcord stops it when it's *stuck* and lets it run when it's not.

The hard part is detecting *rephrased* loops. An agent stuck on a broken Docker fix will call `search_web` with a slightly different query each turn, evading a simple name-count check indefinitely. Worse: a smarter agent rotates tool names (`search_web → web_search → lookup_docs`) so even exact-match never fires. With exact-match absent, the loop is **unbounded** — not merely expensive. It runs until you hit a rate limit, a billing cap, or a timeout you configured somewhere else entirely.

### How Killcord detects loops

Embed only the **natural-language content** of each call: string argument values that contain whitespace and are ≥ 8 chars, or are ≥ 25 chars. Integers, short tokens, IDs, and enums are excluded. A call with no NL content (pagination, ID lookups) produces nothing to embed and cannot form a semantic loop — it falls through to exact-match only.

The tool name is **intentionally excluded** from the embed string. Exact-match already tracks names; semantic detection tracks *meaning*. Including the tool name in the embed would lower cosine similarity between calls that use different names for the same intent, defeating the point.

Measured with `node scripts/measure-semantic-fix.mjs` (requires `npm run build` first):

| Sequence | NL content? | result |
|---|---|---|
| `list_orders {page:1…5}` | none (integers only) | no trip ✓ |
| `get_user {id: user_1042…}` | none (short IDs) | no trip ✓ |
| `get_weather {city: Tokyo, London…}` | none (short city names) | no trip ✓ |
| `search_web` "docker permission denied fix" × 5, rephrased | yes | TRIPS at call #4 ✓ |
| `search_web → web_search → lookup_docs → find_docs`, same query intent | yes | TRIPS at call #4 ✓ |

**5/5 clean separation** at threshold 0.94. The measurement script imports `getEmbedStringForCall` directly from the compiled proxy, so the numbers reflect what ships.

### What exact-match misses that semantic catches

The demo in `scripts/demo-runaway-agent.mjs` shows two scenarios side-by-side:

**Scenario 1 — same tool name, rephrased query.** Exact-match trips at call #6 (default limit 5). Semantic trips at call #4.

**Scenario 2 — rotating tool names, same query intent.** An agent cycling through `search_web → web_search → lookup_docs → find_docs → query_index → browse_web →` … (10 names in rotation). Exact-match **never fires** — no single name reaches the repeat limit. The loop is unbounded. Semantic trips at call #4 anyway because the embedded NL content is identical regardless of tool name.

Over 40 turns with 500-token base context and 100-token growth per turn, that unbounded loop accumulates ~98,000 input tokens — $0.29 at $3.00/Mtok (Claude Sonnet 3.5 input). That figure is a deliberately small illustration: a real agent with a larger context window, longer history, or more expensive model scales proportionally, with no ceiling until you hit a billing cap.

### Example 429 response

When Killcord trips the semantic breaker:

```json
{
  "error": "circuit_breaker_tripped",
  "reason": "semantic_loop",
  "mechanism": "semantic",
  "similarity": 0.969,
  "detail": "Tool call #4 (\"search_web\") is 96.9% semantically similar to 3 of the previous 3 calls. Threshold: 0.94.",
  "retry_after": 60
}
```

Your agent sees a structured reason it can act on: log, escalate to a human, or change strategy. Not a silent token burn followed by a vague error.

## Detection order

Three checks, cheapest first:

1. **Exact-match** — counts identical tool names per request in O(n). Catches naive loops instantly with no model.
2. **Semantic** — embeds NL content of each call, trips when ≥ `KILLCORD_SEMANTIC_REPEATS` of the last `KILLCORD_SEMANTIC_WINDOW` calls exceed cosine threshold. ~2–3 ms/request at steady state (warm model, LRU cache).
3. **Cross-request** (Redis) — sliding-window counters for token bursts and request floods across requests from the same session.

## Replay traces

Every proxied request is captured as a JSONL trace in `.killcord/traces/` (opt out with `KILLCORD_TRACE_ENABLED=false`).

```bash
killcord replay               # list recent traces with CB status
killcord replay <traceId>     # open browser viewer on :3030
```

Traces include latency, tools offered vs. forwarded, token counts, and whether the circuit breaker fired and why.

## Configuration

All options are documented in `.env.example`. Key knobs:

| Variable | Default | What it controls |
|---|---|---|
| `KILLCORD_SEMANTIC_LOOP_ENABLED` | `true` | Master switch for semantic detection |
| `KILLCORD_SEMANTIC_THRESHOLD` | `0.94` | Cosine similarity to count a match |
| `KILLCORD_SEMANTIC_WINDOW` | `5` | How many prior calls to compare against |
| `KILLCORD_SEMANTIC_REPEATS` | `3` | Matches within window required to trip |
| `KILLCORD_SEMANTIC_INCLUDE_ARGS` | `false` | Embed full JSON args instead of NL content only (higher recall; pagination will false-positive) |
| `CB_TOOL_REPEAT_LIMIT` | `5` | Identical tool names before exact-match trip |

## Known limitations

These are not hedges — they are real failure cases measured during development:

1. **Scalar-only loops are invisible.** An agent stuck on `charge_card {amount: 100}` / `{amount: 101}` / `{amount: 100}` with no free-text arguments produces nothing to embed. Semantic detection never fires; it falls to exact-match, which only catches it if the *name* repeats more than `CB_TOOL_REPEAT_LIMIT` times. An alternating-scalar loop evades both.

2. **Short-phrase same-tool loops.** If an agent repeats the same tool with short, varied labels — `create_ticket {title: "Login broken"}` → `{title: "Login is broken"}` — the 3–5 word phrases score inconsistently near the 0.94 threshold. Detection is not reliable for same-tool sequences with short (< ~30 char) argument strings. Use `KILLCORD_SEMANTIC_INCLUDE_ARGS=true` to embed full JSON in that case, accepting that pagination will then false-positive.

3. **Multi-tool pipelines with shared content.** If a legitimate pipeline passes the same text through different tools — `draft_email → send_email → log_email`, all with the same body — semantic detection will trip at step 4, because the identical NL content embeds to cosine = 1.0 regardless of tool name. This is a false positive. The same false positive existed in the previous approach (tool-name prefix included), because the body text dominated the embedding. Distinguishing a stuck-agent loop from a legitimate pipeline requires observing tool *results*, not just calls — see the planned next step below.

4. **The NL-content heuristic is crude** (whitespace + len ≥ 8, or len ≥ 25). A UUID (36 chars) qualifies as "natural language," so a batch of `get_record {id: <uuid>}` calls will be embedded — and UUIDs with shared prefixes can score moderately high cosines. Conversely, short meaningful args (`"SF"`, country codes) are excluded, so cosmetically-varied short-scalar loops are missed.

5. **Refinement vs. stuck rephrasing are indistinguishable.** A user productively narrowing a search — `"red shoes"` → `"red shoes size 10"` → `"red shoes size 10 nike"` — scores ≥ 0.9 and looks identical to an agent uselessly rephrasing the same query. Cosine similarity measures surface resemblance, not whether the agent is *advancing*. This requires observing tool *results*, not just calls — see the planned next step below.

6. **Truncation blindness.** Inputs are sliced to 512 chars (MiniLM's effective limit). Two calls differing only in a late portion of a long argument embed identically and are treated as a match.

7. **Window evasion.** Detection compares within a sliding window of `KILLCORD_SEMANTIC_WINDOW` (default 5) calls. A slow loop that repeats every 6th call slips the window, and if names vary, exact-match misses it too.

8. **Cross-request loops.** Semantic detection operates on the `messages` array in a single HTTP request. If an agent sends its history as a fresh conversation each turn (no accumulated context), repeated calls across requests are not correlated. The Redis cross-request tracker catches name-count repetition but not semantic similarity across requests.

### Planned: tool-result-aware detection

The right fix for limitations #3 and #5 is comparing tool *results*, not just calls. If a model keeps calling `search_web` with slightly different queries and the result content is converging (cosine similarity of successive result texts is increasing), that is stuck behaviour. If result content is diverging or the agent's follow-up differs, that is progress.

This would require Killcord to intercept and buffer `tool_result` / `role: tool` messages and correlate them with the preceding calls — which the proxy architecture supports. It's the planned follow-on to the current NL-content approach. Cross-request semantic detection (limitation #8) becomes tractable at the same time: the Redis layer already tracks sessions; adding a small rolling embedding store per session-key unlocks it.

## Contributing

Open an issue or pull request at https://github.com/landonelder2410/killcord/issues. This is early-stage software. The semantic threshold (0.94) and NL-extraction heuristic are the most likely areas needing calibration for different agent patterns. If you have a real-world loop sequence that this misses or a false-positive case it catches incorrectly, open an issue with the raw tool call sequence and we will add it to the measurement harness.

## License

MIT — see [LICENSE](LICENSE).
