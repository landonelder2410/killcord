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

The hard part is detecting *rephrased* loops. An agent stuck on a broken Docker fix will call `search_web` with a slightly different query each turn, evading a simple name-count check indefinitely.

### What the naive embedding approach gets wrong

Embed the full JSON string of each tool call and compare cosines against a threshold. Sounds reasonable. Measured on MiniLM-L6-v2 with `node scripts/measure-semantic.mjs`:

| Sequence | avg cosine | verdict at 0.94 |
|---|---|---|
| `list_orders {page:1}` → `{page:2}` → … → `{page:5}` | **0.973** | TRIPS — false positive |
| `search_web` "docker fix", rephrased × 5 | 0.964 | TRIPS — correct |
| `create_ticket` "Login broken", reworded × 5 | 0.981 | TRIPS — correct |
| `get_user {id: user_1042}` → `user_8891` → … | 0.915 | no trip — correct |

Pagination (`page: 1…5`) scores **higher** than a genuine reworded loop (0.973 vs. 0.964) because only a digit changes, making consecutive pages look maximally similar. A single global cosine threshold cannot separate these classes: raising it past 0.973 to exclude pagination drops the weakest genuine loop (0.964) too.

### What Killcord does instead

Embed only the **natural-language content** of each call: string argument values that contain whitespace and are ≥ 8 chars, or are ≥ 25 chars. Integers, short tokens, IDs, and enums are excluded. A call with no NL content (pagination, ID lookups) produces nothing to embed and cannot form a semantic loop — it falls through to exact-match only.

Measured with `node scripts/measure-semantic-fix.mjs`:

| Sequence | NL content? | result |
|---|---|---|
| `list_orders {page:1…5}` | none (integers only) | no trip ✓ |
| `get_user {id: user_1042…}` | none (short IDs) | no trip ✓ |
| `get_weather {city: Tokyo, London…}` | none (short strings) | no trip ✓ |
| `search_web` "docker permission denied fix" × 5 | yes | TRIPS at call #4 ✓ |
| `create_ticket` "Login button broken" × 5 | yes | TRIPS at call #4 ✓ |

**6/6 clean separation** at threshold 0.94. The measurement script is in `scripts/measure-semantic-fix.mjs`; run it to reproduce.

Marginal cost at steady state: **~6 ms/request** (one embed per new call; prior calls LRU-cached by string hash). Model cold-start is ~3.7 s; `warmup()` is called at startup so requests don't pay it.

### Example 429 response

When Killcord trips the semantic breaker:

```json
{
  "error": "circuit_breaker_tripped",
  "reason": "semantic_loop",
  "mechanism": "semantic",
  "similarity": 0.978,
  "detail": "Tool call #4 (\"search_web\") is 97.8% semantically similar to 3 of the previous 3 calls. Threshold: 0.94.",
  "retry_after": 60
}
```

Your agent sees a structured reason it can act on: log, escalate to a human, or change strategy. Not a silent token burn followed by a vague error.

## Detection order

Three checks, cheapest first:

1. **Exact-match** — counts identical tool names per request in O(n). Catches naive loops instantly with no model.
2. **Semantic** — embeds NL content of each call, trips when ≥ `KILLCORD_SEMANTIC_REPEATS` of the last `KILLCORD_SEMANTIC_WINDOW` calls exceed cosine threshold. ~6 ms/request at steady state.
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

2. **The NL-content heuristic is crude** (whitespace + len ≥ 8, or len ≥ 25). A UUID (36 chars) qualifies as "natural language," so a batch of `get_record {id: <uuid>}` calls will be embedded — and UUIDs with shared prefixes can score moderately high cosines. Conversely, short meaningful args (`"SF"`, country codes) are excluded, so cosmetically-varied short-scalar loops are missed.

3. **Refinement vs. stuck rephrasing are indistinguishable.** A user productively narrowing a search — `"red shoes"` → `"red shoes size 10"` → `"red shoes size 10 nike"` — scores ≥ 0.9 and looks identical to an agent uselessly rephrasing the same query. Cosine similarity measures surface resemblance, not whether the agent is *advancing*. This requires observing tool *results*, not just calls — see the planned next step below.

4. **Truncation blindness.** Inputs are sliced to 512 chars (MiniLM's effective limit). Two calls differing only in a late portion of a long argument embed identically and are treated as a match.

5. **Window evasion.** Detection compares within a sliding window of `KILLCORD_SEMANTIC_WINDOW` (default 5) calls. A slow loop that repeats every 6th call slips the window, and if names vary, exact-match misses it too.

6. **Cross-request loops.** Semantic detection operates on the `messages` array in a single HTTP request. If an agent sends its history as a fresh conversation each turn (no accumulated context), repeated calls across requests are not correlated. The Redis cross-request tracker catches name-count repetition but not semantic similarity across requests.

### Planned: tool-result-aware detection

The right fix for limitation #3 is comparing tool *results*, not just calls. If a model keeps calling `search_web` with slightly different queries and the result content is converging (cosine similarity of successive result texts is increasing), that is stuck behaviour. If result content is diverging or the agent's follow-up differs, that is progress.

This would require Killcord to intercept and buffer `tool_result` / `role: tool` messages and correlate them with the preceding calls — which the proxy architecture supports. It's the planned follow-on to the current NL-content approach. Cross-request semantic detection (limitation #6) becomes tractable at the same time: the Redis layer already tracks sessions; adding a small rolling embedding store per session-key unlocks it.

## Contributing

Open an issue or pull request at https://github.com/landonelder2410/killcord/issues. This is early-stage software. The semantic threshold (0.94) and NL-extraction heuristic are the most likely areas needing calibration for different agent patterns. If you have a real-world loop sequence that this misses or a false-positive case it catches incorrectly, open an issue with the raw tool call sequence and we will add it to the measurement harness.

## License

MIT — see [LICENSE](LICENSE).
