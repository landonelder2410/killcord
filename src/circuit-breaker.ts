/**
 * Circuit breaker for detecting rogue agent loops.
 *
 * Three independent checks, applied cheapest-first:
 *  1. scanHistoryForLoop         — exact-match: counts identical tool NAMES in the
 *                                  messages array. O(n), no model. Catches naive loops.
 *  2. scanHistoryForSemanticLoop — semantic: embeds each tool call and trips when a
 *                                  call is near-identical (cosine > threshold) to
 *                                  several recent calls. Catches loops that rephrase
 *                                  their arguments each turn to dodge exact-match.
 *  3. checkCrossRequestLimits    — Redis/in-memory sliding-window; catches request
 *                                  floods and token bursts across requests.
 *
 * Per-request overrides via request headers:
 *   x-killcord-loop-limit    — integer: overrides CB_TOOL_REPEAT_LIMIT for this request
 *   x-killcord-fail-strategy — 'fail-open' (default) | 'fail-closed':
 *                            Controls behavior when Redis is unavailable.
 *                            fail-open  → log the error and allow the request through
 *                            fail-closed → log the error and deny the request
 *
 * Global env vars:
 *   CB_WINDOW_MS          (default 60000)  — tracking window in milliseconds
 *   CB_TOOL_REPEAT_LIMIT  (default 5)      — max identical tool calls before trip
 *   CB_TOKEN_BURST_LIMIT  (default 50000)  — max estimated tokens per window per session
 *   CB_REQUEST_LIMIT      (default 30)     — max requests per window per session
 *
 * Semantic detection env vars:
 *   KILLCORD_SEMANTIC_LOOP_ENABLED  (default true)  — master switch
 *   KILLCORD_SEMANTIC_THRESHOLD     (default 0.94)  — cosine similarity to count a match
 *   KILLCORD_SEMANTIC_WINDOW        (default 5)     — how many prior calls to compare against
 *   KILLCORD_SEMANTIC_REPEATS       (default 3)     — matches within window required to trip
 *   KILLCORD_SEMANTIC_INCLUDE_ARGS  (default false) — see note below
 *
 * NOTE on what gets embedded (measured deviation from a naive design):
 *   Embedding the raw `name:JSON.stringify(input)` string does NOT separate genuine
 *   loops from legitimate scalar-varying repeats. Measured on MiniLM-L6-v2: paginating
 *   `list_orders {page:1..5}` scores avg cosine 0.973 — HIGHER than a genuinely
 *   reworded loop (0.964) — because only a digit changes. A single global threshold
 *   cannot separate them (see scripts/measure-semantic.mjs).
 *   Fix (see scripts/measure-semantic-fix.mjs, 6/6 clean): embed only the
 *   NATURAL-LANGUAGE content of each call (free-text string args). Pagination / ID
 *   lookups have no NL content, so they cannot form a semantic loop and fall through
 *   to exact-match only. Set KILLCORD_SEMANTIC_INCLUDE_ARGS=true to embed the full
 *   JSON instead (higher recall, but pagination will false-positive).
 */
import Redis                                        from 'ioredis';
import { createHash }                               from 'node:crypto';
import { getEmbedder, cosine, isEmbedderReady }     from './embedder';

export interface CircuitBreakerResult {
  tripped: boolean;
  reason?:  'tool_loop' | 'token_burst' | 'request_flood' | 'semantic_loop';
  detail?:  string;
  /** Which detection mechanism fired — surfaced in the 429 body and trace. */
  mechanism?: 'exact' | 'semantic';
  /** Cosine similarity of the offending call pair (semantic trips only). */
  similarity?: number;
}

/** Per-request options parsed from x-killcord-* headers. */
export interface CBOptions {
  /** Override CB_TOOL_REPEAT_LIMIT for a single request. */
  loopLimit?:    number;
  /** 'fail-open' (default) allows requests when Redis is down; 'fail-closed' denies them. */
  failStrategy?: 'fail-open' | 'fail-closed';
}

const WINDOW_MS     = parseInt(process.env.CB_WINDOW_MS         ?? '60000', 10);
const TOOL_LIMIT    = parseInt(process.env.CB_TOOL_REPEAT_LIMIT ?? '5',     10);
const TOKEN_LIMIT   = parseInt(process.env.CB_TOKEN_BURST_LIMIT ?? '50000', 10);
const REQUEST_LIMIT = parseInt(process.env.CB_REQUEST_LIMIT     ?? '30',    10);
const REDIS_TIMEOUT = 500;

// ── Semantic loop detection config ──────────────────────────────────────────

const SEMANTIC_ENABLED = process.env.KILLCORD_SEMANTIC_LOOP_ENABLED !== 'false';

function numEnv(name: string, def: number): number {
  const v = parseFloat(process.env[name] ?? '');
  return Number.isFinite(v) ? v : def;
}

const SEMANTIC_THRESHOLD    = numEnv('KILLCORD_SEMANTIC_THRESHOLD', 0.94);
const SEMANTIC_WINDOW       = Math.max(1, Math.floor(numEnv('KILLCORD_SEMANTIC_WINDOW',  5)));
const SEMANTIC_REPEATS      = Math.max(1, Math.floor(numEnv('KILLCORD_SEMANTIC_REPEATS', 3)));
const SEMANTIC_INCLUDE_ARGS = process.env.KILLCORD_SEMANTIC_INCLUDE_ARGS === 'true';

// ── Header parsing ─────────────────────────────────────────────────────────

/**
 * Parse CB options from Express request headers.
 * Called once per request in the middleware; result is threaded through to CB functions.
 */
export function parseCBHeaders(
  headers: Record<string, string | string[] | undefined>,
): CBOptions {
  const hdr = (name: string): string | undefined => {
    const v = headers[name];
    return Array.isArray(v) ? v[0] : v;
  };

  const rawLimit    = hdr('x-killcord-loop-limit');
  const parsedLimit = rawLimit ? parseInt(rawLimit, 10) : NaN;
  const loopLimit   = !isNaN(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined;

  const rawStrategy = hdr('x-killcord-fail-strategy');
  const failStrategy: CBOptions['failStrategy'] =
    rawStrategy === 'fail-closed' ? 'fail-closed' :
    rawStrategy === 'fail-open'   ? 'fail-open'   :
    undefined;

  return { ...(loopLimit !== undefined ? { loopLimit } : {}),
           ...(failStrategy           ? { failStrategy } : {}) };
}

// ── Redis singleton ────────────────────────────────────────────────────────

let _redis: Redis | null = null;

function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      lazyConnect:          true,
      enableOfflineQueue:   false,
      maxRetriesPerRequest: 0,
      connectTimeout:       2_000,
    });
    _redis.on('error', (err: Error) => {
      console.warn('[killcord/cb] Redis error (in-memory fallback active):', err.message);
    });
  }
  return _redis;
}

export async function disconnectCbRedis(): Promise<void> {
  if (_redis) {
    try { await _redis.quit(); } catch { _redis.disconnect(); }
    _redis = null;
  }
}

// ── Stateless conversation-history scan ────────────────────────────────────
// Scans the messages array for repeated tool_use/tool_calls in a single request.
// Works for Anthropic (content[].type === 'tool_use') and OpenAI (tool_calls[]).

export function scanHistoryForLoop(
  messages: Array<Record<string, unknown>>,
  options?: CBOptions,
): CircuitBreakerResult {
  const limit      = options?.loopLimit ?? TOOL_LIMIT;
  const toolCounts = new Map<string, number>();

  for (const msg of messages) {
    if (msg['role'] !== 'assistant') continue;

    const content = msg['content'];
    if (Array.isArray(content)) {
      for (const block of content as Array<{ type?: string; name?: string }>) {
        if (block.type === 'tool_use' && block.name) {
          toolCounts.set(block.name, (toolCounts.get(block.name) ?? 0) + 1);
        }
      }
    }

    const toolCalls = msg['tool_calls'];
    if (Array.isArray(toolCalls)) {
      for (const tc of toolCalls as Array<{ function?: { name?: string } }>) {
        const name = tc.function?.name;
        if (name) toolCounts.set(name, (toolCounts.get(name) ?? 0) + 1);
      }
    }
  }

  for (const [name, count] of toolCounts) {
    if (count > limit) {
      return {
        tripped:   true,
        reason:    'tool_loop',
        mechanism: 'exact',
        detail:    `Tool "${name}" appears ${count}× in conversation history (limit: ${limit} per ${WINDOW_MS / 1000}s window)`,
      };
    }
  }

  return { tripped: false };
}

// ── Semantic conversation-history scan ──────────────────────────────────────
// Embeds each tool call and trips when a call is near-identical (cosine >
// threshold) to several recent calls. Catches loops that exact-match misses
// because the agent rephrases its arguments slightly each turn.
//
// Fails open: if semantic detection is disabled, the embedder isn't ready, or
// embedding throws, this returns { tripped: false } and the request proceeds
// on exact-match alone. A request must never fail because semantic detection
// had a problem.

interface OrderedCall { name: string; input: unknown; }

/** Pull tool calls out of assistant turns, in order. Handles Anthropic
 *  (content[].type==='tool_use') and OpenAI (message.tool_calls[]). */
function extractOrderedCalls(messages: Array<Record<string, unknown>>): OrderedCall[] {
  const calls: OrderedCall[] = [];
  for (const msg of messages) {
    if (msg['role'] !== 'assistant') continue;

    const content = msg['content'];
    if (Array.isArray(content)) {
      for (const block of content as Array<{ type?: string; name?: string; input?: unknown }>) {
        if (block.type === 'tool_use' && block.name) {
          calls.push({ name: block.name, input: block.input ?? {} });
        }
      }
    }

    const toolCalls = msg['tool_calls'];
    if (Array.isArray(toolCalls)) {
      for (const tc of toolCalls as Array<{ function?: { name?: string; arguments?: string } }>) {
        const name = tc.function?.name;
        if (!name) continue;
        let input: unknown = tc.function?.arguments ?? '';
        if (typeof input === 'string') {
          try { input = JSON.parse(input); } catch { /* keep raw string */ }
        }
        calls.push({ name, input });
      }
    }
  }
  return calls;
}

// A string value counts as natural-language content if it contains whitespace
// and is reasonably long, or is long on its own. This excludes IDs, enums,
// numbers, page cursors, and short tokens — the args that legitimately vary
// during pagination and batch lookups.
function isNaturalLanguage(v: unknown): v is string {
  return typeof v === 'string' && ((/\s/.test(v) && v.length >= 8) || v.length >= 25);
}

function extractNaturalLanguage(input: unknown): string {
  const parts: string[] = [];
  const walk = (v: unknown): void => {
    if (isNaturalLanguage(v)) parts.push(v);
    else if (v && typeof v === 'object') {
      for (const val of Object.values(v as Record<string, unknown>)) walk(val);
    }
  };
  walk(input);
  return parts.join(' ');
}

/** The string embedded for a call, or null if the call has no comparable
 *  semantic content (and therefore cannot form a semantic loop). */
function embedStringForCall(c: OrderedCall): string | null {
  if (SEMANTIC_INCLUDE_ARGS) return `${c.name}:${JSON.stringify(c.input)}`;
  const nl = extractNaturalLanguage(c.input);
  return nl ? `${c.name}: ${nl}` : null;
}

// ── LRU embedding cache (by string hash) ────────────────────────────────────

const EMBED_CACHE_MAX = 512;
const _embedCache = new Map<string, Float32Array>();

function cacheKey(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

function cacheGet(key: string): Float32Array | undefined {
  const v = _embedCache.get(key);
  if (v !== undefined) { _embedCache.delete(key); _embedCache.set(key, v); } // refresh LRU
  return v;
}

function cacheSet(key: string, val: Float32Array): void {
  if (_embedCache.has(key)) _embedCache.delete(key);
  _embedCache.set(key, val);
  while (_embedCache.size > EMBED_CACHE_MAX) {
    const oldest = _embedCache.keys().next().value as string;
    _embedCache.delete(oldest);
  }
}

async function embedAllCached(strings: Array<string | null>): Promise<Array<Float32Array | null>> {
  const embedder = await getEmbedder();
  const out: Array<Float32Array | null> = new Array(strings.length).fill(null);
  for (let i = 0; i < strings.length; i++) {
    const s = strings[i];
    if (s === null) continue;
    const key = cacheKey(s);
    const cached = cacheGet(key);
    if (cached) { out[i] = cached; continue; }
    const res = await embedder(s.slice(0, 512), { pooling: 'mean', normalize: true });
    cacheSet(key, res.data);
    out[i] = res.data;
  }
  return out;
}

// ── log-once helper ──────────────────────────────────────────────────────────

const _loggedOnce = new Set<string>();
function logOnce(key: string, msg: string): void {
  if (_loggedOnce.has(key)) return;
  _loggedOnce.add(key);
  console.warn(msg);
}

/**
 * Semantic loop scan. Async because it embeds call history. Never throws.
 */
export async function scanHistoryForSemanticLoop(
  messages: Array<Record<string, unknown>>,
): Promise<CircuitBreakerResult> {
  if (!SEMANTIC_ENABLED) return { tripped: false };

  // Fail open on a cold model — never block a request on a ~90 MB download.
  if (!isEmbedderReady()) {
    logOnce('sem_not_ready',
      '[killcord/cb] Semantic loop detection skipped — embedder not ready yet (using exact-match only).');
    return { tripped: false };
  }

  const calls = extractOrderedCalls(messages);
  if (calls.length <= SEMANTIC_REPEATS) return { tripped: false };

  const strings      = calls.map(embedStringForCall);
  const comparable   = strings.map((s, i) => (s !== null ? i : -1)).filter(i => i >= 0);
  if (comparable.length <= SEMANTIC_REPEATS) return { tripped: false };

  let vectors: Array<Float32Array | null>;
  try {
    vectors = await embedAllCached(strings);
  } catch (err) {
    logOnce('sem_embed_err',
      `[killcord/cb] Semantic embedding error — falling back to exact-match: ${err instanceof Error ? err.message : String(err)}`);
    return { tripped: false };
  }

  // Slide over comparable calls; count near-duplicates among the prior window.
  for (let p = SEMANTIC_REPEATS; p < comparable.length; p++) {
    const i  = comparable[p];
    const vi = vectors[i];
    if (!vi) continue;

    const start = Math.max(0, p - SEMANTIC_WINDOW);
    let matches = 0, best = 0, bestIdx = -1;

    for (let q = start; q < p; q++) {
      const j  = comparable[q];
      const vj = vectors[j];
      if (!vj) continue;
      const score = cosine(vi, vj);
      if (score > SEMANTIC_THRESHOLD) {
        matches++;
        if (score > best) { best = score; bestIdx = j; }
      }
    }

    if (matches >= SEMANTIC_REPEATS) {
      return {
        tripped:    true,
        reason:     'semantic_loop',
        mechanism:  'semantic',
        similarity: best,
        detail:
          `Tool call #${i + 1} ("${calls[i].name}") is ${(best * 100).toFixed(1)}% ` +
          `semantically similar to ${matches} of the previous ${p - start} call(s) — ` +
          `e.g. call #${bestIdx + 1} ("${calls[bestIdx].name}"). The agent appears stuck ` +
          `repeating the same action with cosmetic changes ` +
          `(threshold ${SEMANTIC_THRESHOLD}, window ${SEMANTIC_WINDOW}, repeats ${SEMANTIC_REPEATS}).`,
      };
    }
  }

  return { tripped: false };
}

// ── In-memory fallback (used when Redis is unavailable) ────────────────────

interface MemBucket { timestamps: number[]; tokenSum: number; }
const _memBuckets = new Map<string, MemBucket>();

setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [k, b] of _memBuckets) {
    if (b.timestamps.length === 0 || b.timestamps.at(-1)! < cutoff) _memBuckets.delete(k);
  }
}, WINDOW_MS).unref();

function memRecord(key: string, tokens = 0): { count: number; tokenSum: number } {
  const now = Date.now(); const cutoff = now - WINDOW_MS;
  let b = _memBuckets.get(key);
  if (!b) { b = { timestamps: [], tokenSum: 0 }; _memBuckets.set(key, b); }
  b.timestamps = b.timestamps.filter(t => t > cutoff);
  b.timestamps.push(now);
  b.tokenSum += tokens;
  return { count: b.timestamps.length, tokenSum: b.tokenSum };
}

// ── Lua scripts ────────────────────────────────────────────────────────────

// Sliding-window counter — returns the new count AFTER recording this event.
const COUNTER_LUA = `
local key    = KEYS[1]
local now    = tonumber(ARGV[1])
local win_ms = tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - win_ms)
local count = tonumber(redis.call('ZCARD', key))
redis.call('ZADD', key, now, tostring(now) .. ':' .. math.random(0, 2147483647))
redis.call('PEXPIRE', key, win_ms)
return count + 1
`;

// Token accumulator — sums tokens within window TTL.
const TOKEN_LUA = `
local key    = KEYS[1]
local tokens = tonumber(ARGV[1])
local win_ms = tonumber(ARGV[2])
local cur    = tonumber(redis.call('GET', key) or '0')
local total  = cur + tokens
redis.call('SET', key, total)
redis.call('PEXPIRE', key, win_ms)
return total
`;

// ── Redis-backed cross-request check ──────────────────────────────────────

async function redisCheck(sessionKey: string, tokens: number): Promise<CircuitBreakerResult> {
  const redis = getRedis();
  const now   = String(Date.now());
  const win   = String(WINDOW_MS);

  const withTimeout = <T>(p: Promise<T>) => Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('redis_timeout')), REDIS_TIMEOUT)),
  ]);

  const reqCount = Number(await withTimeout(
    redis.eval(COUNTER_LUA, 1, `killcord:cb:req:${sessionKey}`, now, win),
  ));
  if (reqCount > REQUEST_LIMIT) {
    return {
      tripped: true,
      reason:  'request_flood',
      detail:  `${reqCount} requests in ${WINDOW_MS / 1000}s from session "${sessionKey}" (limit: ${REQUEST_LIMIT})`,
    };
  }

  const tokenTotal = Number(await withTimeout(
    redis.eval(TOKEN_LUA, 1, `killcord:cb:tok:${sessionKey}`, String(tokens), win),
  ));
  if (tokenTotal > TOKEN_LIMIT) {
    return {
      tripped: true,
      reason:  'token_burst',
      detail:  `~${tokenTotal} estimated tokens in ${WINDOW_MS / 1000}s (limit: ${TOKEN_LIMIT})`,
    };
  }

  return { tripped: false };
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Cross-request tracking: always runs the in-memory check (reliable in single-process),
 * then also fires the Redis check for cross-worker visibility.
 *
 * In-memory guarantees the CB works even when Redis is unavailable.
 * Redis adds cross-worker visibility in multi-worker mode.
 *
 * Fail-strategy (from x-killcord-fail-strategy header, default 'fail-open'):
 *   fail-open   → Redis failure is logged; in-memory result stands
 *   fail-closed → Redis failure is logged and the request is denied
 */
export async function checkCrossRequestLimits(
  sessionKey:      string,
  estimatedTokens: number,
  options?:        CBOptions,
): Promise<CircuitBreakerResult> {
  const failStrategy = options?.failStrategy ?? 'fail-open';

  // In-memory check always runs — fast and reliable within a single process/worker.
  const { count, tokenSum } = memRecord(sessionKey, estimatedTokens);
  if (count > REQUEST_LIMIT) {
    return {
      tripped: true,
      reason:  'request_flood',
      detail:  `${count} requests in ${WINDOW_MS / 1000}s from session "${sessionKey}" (limit: ${REQUEST_LIMIT})`,
    };
  }
  if (tokenSum > TOKEN_LIMIT) {
    return {
      tripped: true,
      reason:  'token_burst',
      detail:  `~${tokenSum} estimated tokens in ${WINDOW_MS / 1000}s (limit: ${TOKEN_LIMIT})`,
    };
  }

  // Redis check provides cross-worker visibility.
  try {
    const distributed = await redisCheck(sessionKey, estimatedTokens);
    if (distributed.tripped) {
      return distributed;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (failStrategy === 'fail-closed') {
      console.warn(`[killcord/cb] Redis unavailable; fail-closed → denying request. session=${sessionKey} err=${msg}`);
      return {
        tripped: true,
        reason:  'request_flood',
        detail:  `Redis unavailable (fail-closed strategy): ${msg}`,
      };
    }
    // fail-open: log and allow through
    console.warn(`[killcord/cb] Redis unavailable; fail-open → allowing request. session=${sessionKey} err=${msg}`);
  }

  return { tripped: false };
}

/**
 * Extract a stable session key from the request. Prefers x-killcord-session-id
 * (set by the calling agent) and falls back to the client IP so stateless
 * callers are still tracked at the IP level.
 */
export function resolveSessionKey(
  headers: Record<string, string | string[] | undefined>,
  ip:      string,
): string {
  const sid = headers['x-killcord-session-id'];
  const raw = Array.isArray(sid) ? sid[0] : sid;
  if (raw && raw.length <= 128) return `sid:${raw.replace(/[^a-zA-Z0-9-_]/g, '_')}`;
  return `ip:${ip}`;
}
