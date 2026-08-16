import type { Request, Response, NextFunction } from 'express';
import Redis                                     from 'ioredis';

const DEFAULT_MAX    = 1_000;
const DEFAULT_WINDOW = 60_000; // ms
const REDIS_TIMEOUT  =    500; // give up on Redis and fall back to memory after 500 ms

// ── Redis singleton ────────────────────────────────────────────────────────

let _redis: Redis | null = null;

function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      lazyConnect:          true,
      enableOfflineQueue:   false, // reject commands immediately when disconnected
      maxRetriesPerRequest: 0,     // fail-fast — no retry storms
      connectTimeout:       2_000,
    });
    _redis.on('error', (err: Error) => {
      // Logged once per error burst; doesn't propagate to request handlers.
      console.warn('[aether] Redis error (rate limiter using in-memory fallback):', err.message);
    });
  }
  return _redis;
}

// Exported so shutdown handlers can disconnect the client cleanly.
export async function disconnectRedis(): Promise<void> {
  if (_redis) {
    try {
      await _redis.quit();
    } catch {
      _redis.disconnect();
    }
    _redis = null;
  }
}

// ── Lua sliding-window script ──────────────────────────────────────────────
// Executes atomically in Redis (single-threaded): prune expired entries,
// count the window, add this request if below the cap, refresh the TTL.

const SLIDING_WINDOW_LUA = `
local key    = KEYS[1]
local now    = tonumber(ARGV[1])
local win_ms = tonumber(ARGV[2])
local max    = tonumber(ARGV[3])
local cutoff = now - win_ms

redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff)
local count = tonumber(redis.call('ZCARD', key))

if count < max then
  redis.call('ZADD', key, now, tostring(now) .. ':' .. tostring(math.random(0, 2147483647)))
  redis.call('PEXPIRE', key, win_ms)
  return 1
end
return 0
`;

// ── In-memory fallback ─────────────────────────────────────────────────────
// Used when Redis is unavailable or exceeds REDIS_TIMEOUT. In cluster mode
// each worker maintains its own map (effective limit = max × numWorkers);
// the Redis path provides true cross-worker consistency.

const memWindows = new Map<string, number[]>();

setInterval(() => {
  const cutoff = Date.now() - DEFAULT_WINDOW;
  for (const [ip, times] of memWindows) {
    if (times.length === 0 || times[times.length - 1] <= cutoff) memWindows.delete(ip);
  }
}, DEFAULT_WINDOW).unref();

function checkMemory(ip: string, max: number, windowMs: number): boolean {
  const now    = Date.now();
  const cutoff = now - windowMs;
  const times  = (memWindows.get(ip) ?? []).filter(t => t > cutoff);
  times.push(now);
  memWindows.set(ip, times);
  return times.length <= max;
}

// ── Core check ─────────────────────────────────────────────────────────────

async function isAllowed(bucketKey: string, max: number, windowMs: number): Promise<boolean> {
  try {
    const redisCall = getRedis().eval(
      SLIDING_WINDOW_LUA, 1,
      bucketKey,
      String(Date.now()),
      String(windowMs),
      String(max),
    );

    // Hard cap on Redis latency — never let rate limiting stall a request.
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('redis_timeout')), REDIS_TIMEOUT),
    );

    const result = await Promise.race([redisCall, timeout]);
    return Number(result) === 1;
  } catch {
    // Redis down, slow, or unreachable — fail-open to in-memory window.
    return checkMemory(bucketKey, max, windowMs);
  }
}

// ── Middleware factory ─────────────────────────────────────────────────────

export function rateLimitMiddleware(
  max       = parseInt(process.env.RATE_LIMIT_MAX    ?? String(DEFAULT_MAX),    10),
  windowMs  = parseInt(process.env.RATE_LIMIT_WINDOW ?? String(DEFAULT_WINDOW), 10),
  keyPrefix = 'rl',
) {
  const safeMax    = !isNaN(max)      && max      > 0     ? max      : DEFAULT_MAX;
  const safeWindow = !isNaN(windowMs) && windowMs >= 1_000 ? windowMs : DEFAULT_WINDOW;

  return function rateLimit(req: Request, res: Response, next: NextFunction): void {
    const ip     = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const bucket = `aether:${keyPrefix}:${ip}`;

    isAllowed(bucket, safeMax, safeWindow)
      .then(allowed => {
        if (!allowed) {
          const retryAfter = Math.ceil(safeWindow / 1000);
          res.setHeader('Retry-After', String(retryAfter));
          res.status(429).json({
            error:       'rate_limit_exceeded',
            message:     `Maximum ${safeMax} requests per ${safeWindow / 1000} s per IP.`,
            retry_after: retryAfter,
          });
          return;
        }
        next();
      })
      .catch(() => next()); // fail-open: allow request on unexpected error
  };
}
