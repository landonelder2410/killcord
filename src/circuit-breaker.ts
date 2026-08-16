/**
 * Redis-backed circuit breaker for detecting rogue agent loops.
 *
 * Two independent checks:
 *  1. scanHistoryForLoop       — stateless; reads tool_use/tool_calls in the messages array
 *  2. checkCrossRequestLimits  — Redis sliding-window; catches loops across requests
 *
 * Per-request overrides via request headers:
 *   x-aether-loop-limit    — integer: overrides CB_TOOL_REPEAT_LIMIT for this request
 *   x-aether-fail-strategy — 'fail-open' (default) | 'fail-closed':
 *                            Controls behavior when Redis is unavailable.
 *                            fail-open  → log the error and allow the request through
 *                            fail-closed → log the error and deny the request
 *
 * Global env vars:
 *   CB_WINDOW_MS          (default 60000)  — tracking window in milliseconds
 *   CB_TOOL_REPEAT_LIMIT  (default 5)      — max identical tool calls before trip
 *   CB_TOKEN_BURST_LIMIT  (default 50000)  — max estimated tokens per window per session
 *   CB_REQUEST_LIMIT      (default 30)     — max requests per window per session
 */
import Redis from 'ioredis';
import { recordCircuitBreakerTrip } from './telemetry';

export interface CircuitBreakerResult {
  tripped: boolean;
  reason?:  'tool_loop' | 'token_burst' | 'request_flood';
  detail?:  string;
}

/** Per-request options parsed from x-aether-* headers. */
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

  const rawLimit    = hdr('x-aether-loop-limit');
  const parsedLimit = rawLimit ? parseInt(rawLimit, 10) : NaN;
  const loopLimit   = !isNaN(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined;

  const rawStrategy = hdr('x-aether-fail-strategy');
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
      console.warn('[aether/cb] Redis error (in-memory fallback active):', err.message);
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
      recordCircuitBreakerTrip('tool_loop');
      return {
        tripped: true,
        reason:  'tool_loop',
        detail:  `Tool "${name}" appears ${count}× in conversation history (limit: ${limit} per ${WINDOW_MS / 1000}s window)`,
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
    redis.eval(COUNTER_LUA, 1, `aether:cb:req:${sessionKey}`, now, win),
  ));
  if (reqCount > REQUEST_LIMIT) {
    return {
      tripped: true,
      reason:  'request_flood',
      detail:  `${reqCount} requests in ${WINDOW_MS / 1000}s from session "${sessionKey}" (limit: ${REQUEST_LIMIT})`,
    };
  }

  const tokenTotal = Number(await withTimeout(
    redis.eval(TOKEN_LUA, 1, `aether:cb:tok:${sessionKey}`, String(tokens), win),
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
 * Fail-strategy (from x-aether-fail-strategy header, default 'fail-open'):
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
    recordCircuitBreakerTrip('burst_rate');
    return {
      tripped: true,
      reason:  'request_flood',
      detail:  `${count} requests in ${WINDOW_MS / 1000}s from session "${sessionKey}" (limit: ${REQUEST_LIMIT})`,
    };
  }
  if (tokenSum > TOKEN_LIMIT) {
    recordCircuitBreakerTrip('burst_rate');
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
      recordCircuitBreakerTrip('burst_rate');
      return distributed;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (failStrategy === 'fail-closed') {
      console.warn(`[aether/cb] Redis unavailable; fail-closed → denying request. session=${sessionKey} err=${msg}`);
      recordCircuitBreakerTrip('burst_rate');
      return {
        tripped: true,
        reason:  'request_flood',
        detail:  `Redis unavailable (fail-closed strategy): ${msg}`,
      };
    }
    // fail-open: log and allow through
    console.warn(`[aether/cb] Redis unavailable; fail-open → allowing request. session=${sessionKey} err=${msg}`);
  }

  return { tripped: false };
}

/**
 * Extract a stable session key from the request. Prefers x-aether-session-id
 * (set by the calling agent) and falls back to the client IP so stateless
 * callers are still tracked at the IP level.
 */
export function resolveSessionKey(
  headers: Record<string, string | string[] | undefined>,
  ip:      string,
): string {
  const sid = headers['x-aether-session-id'];
  const raw = Array.isArray(sid) ? sid[0] : sid;
  if (raw && raw.length <= 128) return `sid:${raw.replace(/[^a-zA-Z0-9-_]/g, '_')}`;
  return `ip:${ip}`;
}
