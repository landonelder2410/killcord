import { randomUUID }                from 'node:crypto';
import { Agent, setGlobalDispatcher } from 'undici';
import type { Request, Response, NextFunction } from 'express';
import type {
  AnthropicMessage,
  AnthropicRequest,
  ContentBlock,
  MCPTool,
  OpenAIRequest,
  ScoredTool,
} from './types';
import { redactPII }                                          from './pii';
import { record, estimateTokens }                            from './logger';
import {
  scanHistoryForLoop,
  checkCrossRequestLimits,
  resolveSessionKey,
  parseCBHeaders,
  type CircuitBreakerResult,
  type CBOptions,
}                                                            from './circuit-breaker';
import { classifyRequest, shouldAutoRoute }                  from './complexity-router';

// Persistent keep-alive agent for all upstream LLM API connections — reuses TLS
// sessions and TCP sockets across sequential fetch() calls, cutting per-request
// latency significantly on high-frequency agentic loops. setGlobalDispatcher()
// applies the agent to every fetch() call in this process without per-call changes.
setGlobalDispatcher(new Agent({
  keepAliveTimeout:    10_000,
  keepAliveMaxTimeout: 30_000,
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { pipeline, env } = require('@xenova/transformers');

try {
  env.backends.onnx.wasm.numThreads = 4;
} catch (_) {
  // Older versions may not expose this config; safe to ignore
}

type EmbedPipeline = (text: string, opts: Record<string, unknown>) => Promise<{ data: Float32Array }>;

// Promise-based singleton — concurrent requests before the model resolves
// all await the same promise instead of each starting a fresh download.
let _embedderPromise: Promise<EmbedPipeline> | null = null;

function getEmbedder(): Promise<EmbedPipeline> {
  if (!_embedderPromise) {
    _embedderPromise = (async () => {
      console.log('[killcord] Loading embedding model (first run downloads ~90 MB to cache)...');
      const model = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
      console.log('[killcord] Embedding model ready.');
      return model as EmbedPipeline;
    })();
  }
  return _embedderPromise;
}

async function embed(text: string): Promise<Float32Array> {
  const model = await getEmbedder();
  const output = await model(text.slice(0, 512), { pooling: 'mean', normalize: true });
  return output.data;
}

// Dot product of two L2-normalized vectors == cosine similarity
function cosine(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

export async function warmup(): Promise<void> {
  await getEmbedder();
}

export async function filterTools(
  prompt: string,
  allTools: MCPTool[],
  topK = 2,
): Promise<MCPTool[]> {
  if (allTools.length <= topK) return allTools;

  const texts = [prompt, ...allTools.map(t => `${t.name}: ${t.description || t.name}`)];
  const vectors = await Promise.all(texts.map(embed));

  const promptVec = vectors[0];
  const scored: ScoredTool[] = allTools.map((tool, i) => ({
    tool,
    score: cosine(promptVec, vectors[i + 1]),
  }));

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, topK).map(s => s.tool);

  console.log(
    `[killcord] Filtered ${allTools.length} → ${topK} tools (-${allTools.length - topK}): [${top.map(t => t.name).join(', ')}]`,
  );
  return top;
}

// ── Webhook alert ──────────────────────────────────────────────────────────

// Fires an async POST to WEBHOOK_URL when the circuit breaker trips.
// Completely fire-and-forget: delivery failure is logged but never surfaces
// to the caller. A 5-second timeout prevents a slow webhook endpoint from
// holding open any resources.
function fireWebhook(payload: Record<string, unknown>): void {
  const url = process.env.WEBHOOK_URL;
  if (!url) return;

  fetch(url, {
    method:  'POST',
    headers: { 'content-type': 'application/json' },
    body:    JSON.stringify(payload),
    signal:  AbortSignal.timeout(5_000),
  }).catch(err => {
    console.warn('[killcord] Webhook delivery failed:', err instanceof Error ? err.message : err);
  });
}

// ── PII helpers ────────────────────────────────────────────────────────────

// Walk every text field in a messages array and redact PII in-place.
// Applied before the payload leaves the proxy so sensitive data never
// reaches the upstream LLM API or is stored in any log.
function redactAnthropicMessages(messages: AnthropicMessage[]): void {
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      msg.content = redactPII(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content as ContentBlock[]) {
        if (block.type === 'text' && typeof block.text === 'string') {
          block.text = redactPII(block.text);
        }
      }
    }
  }
}

function redactOpenAIMessages(messages: OpenAIRequest['messages']): void {
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      msg.content = redactPII(msg.content);
    }
  }
}

// ── Prompt extraction ──────────────────────────────────────────────────────

function extractAnthropicPrompt(messages: AnthropicMessage[]): string {
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUser) return '';
  if (typeof lastUser.content === 'string') return lastUser.content;
  return (lastUser.content as ContentBlock[])
    .filter((b): b is ContentBlock & { text: string } => b.type === 'text' && !!b.text)
    .map(b => b.text)
    .join(' ');
}

// ── Proxy core ─────────────────────────────────────────────────────────────

// Full hop-by-hop header set per RFC 2616 §13.5.1 — these must never be
// forwarded because they describe a single transport hop, not end-to-end.
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailers', 'transfer-encoding', 'upgrade', 'content-encoding',
]);

// ── Local-engine routing ───────────────────────────────────────────────────
// Requests for these model names bypass cloud APIs entirely and are forwarded
// to the local inference engine. Semantic filtering is skipped — no per-token
// cloud billing means there is nothing to optimise.
const LOCAL_MODELS     = new Set(['local-killcord', 'llama-cpp']);
const LOCAL_ENGINE_URL = process.env.LOCAL_ENGINE_URL ?? 'http://127.0.0.1:8081';

// ── Retry constants ────────────────────────────────────────────────────────
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES      = 2;    // 3 total attempts before surfacing the error
const BASE_DELAY_MS    = 1_000;

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

async function proxyRequest(
  targetUrl: string,
  req: Request,
  body: unknown,
  res: Response,
): Promise<void> {
  const serialized = JSON.stringify(body);

  // undici v8+ computes content-length from the body itself and throws
  // UND_ERR_INVALID_ARG if the header is also set manually — omit it.
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  for (const [k, v] of Object.entries(req.headers)) {
    if (k === 'host' || k === 'content-length' || k === 'content-type') continue;
    headers[k] = Array.isArray(v) ? v.join(', ') : (v as string);
  }

  let upstream: globalThis.Response | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = BASE_DELAY_MS * (2 ** (attempt - 1)); // 1 s, then 2 s
      console.warn(
        `[killcord] Retrying upstream (attempt ${attempt}/${MAX_RETRIES}, wait ${delay} ms): ${targetUrl}`,
      );
      await sleep(delay);
    }

    try {
      // 2-minute hard timeout per attempt — a hung upstream must not block a worker forever
      upstream = await fetch(targetUrl, {
        method: 'POST',
        headers,
        body: serialized,
        signal: AbortSignal.timeout(120_000),
      });
    } catch (err) {
      if (attempt < MAX_RETRIES) continue;
      const timedOut = err instanceof Error && err.name === 'TimeoutError';
      res.status(timedOut ? 504 : 502).json({
        error:  timedOut ? 'upstream_timeout' : 'upstream_unreachable',
        detail: String(err),
      });
      return;
    }

    // Non-retryable status or last attempt — proceed with this response.
    if (!RETRYABLE_STATUS.has(upstream.status) || attempt === MAX_RETRIES) break;

    // Drain the error body to release the connection before the next attempt.
    await upstream.body?.cancel();
    upstream = null;
  }

  if (!upstream) return; // unreachable guard; narrows type for the lines below

  res.status(upstream.status);
  upstream.headers.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return;
    res.setHeader(key, value);
  });

  if (!upstream.body) { res.end(); return; }

  // Iterative read — no stack growth on arbitrarily long streaming responses
  const reader = upstream.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(value);
  }
  res.end();
}

// ── Middleware ─────────────────────────────────────────────────────────────

export function anthropicFilterMiddleware(upstreamBase: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // ── TRACE ID ────────────────────────────────────────────────────────────
    // Generated once per request. Injected into the response header so
    // enterprise engineers can correlate proxy logs with upstream API traces.
    const traceId = randomUUID();
    res.setHeader('X-Killcord-Trace-Id', traceId);

    const body = req.body as AnthropicRequest;

    // Snapshot originals before any mutation so the fail-open path can
    // restore them and forward the unmodified payload.
    const originalTools = Array.isArray(body.tools) ? [...body.tools] : body.tools;

    const toolsReceived  = Array.isArray(body.tools) ? body.tools.length : 0;
    const tokensReceived = estimateTokens(body.tools ?? []);

    try {
      // ── DYNAMIC PASS-THROUGH ─────────────────────────────────────────────
      // If the body lacks the expected Anthropic shape, skip all processing
      // and forward as-is — unknown payload formats are never rejected.
      if (!Array.isArray(body.messages)) {
        await proxyRequest(`${upstreamBase}/v1/messages`, req, body, res);
        return;
      }

      // ── CIRCUIT BREAKER — HISTORY SCAN ──────────────────────────────────
      // Stateless: detect tool loops embedded in the messages array itself.
      const cbOptions: CBOptions = parseCBHeaders(req.headers as Record<string, string | string[] | undefined>);
      const historyResult: CircuitBreakerResult = scanHistoryForLoop(
        body.messages as unknown as Array<Record<string, unknown>>,
        cbOptions,
      );
      if (historyResult.tripped) {
        const sessionKey = resolveSessionKey(req.headers as Record<string, string | string[] | undefined>, req.ip ?? 'unknown');
        console.warn(`[killcord/cb] History loop detected. session=${sessionKey} traceId=${traceId} reason=${historyResult.reason} detail=${historyResult.detail}`);
        fireWebhook({ event: 'circuit_breaker_tripped', traceId, sessionKey, ...historyResult, endpoint: '/v1/messages', ts: new Date().toISOString() });
        res.status(429).json({
          error:       'circuit_breaker_tripped',
          reason:      historyResult.reason,
          detail:      historyResult.detail,
          retry_after: Math.ceil(parseInt(process.env.CB_WINDOW_MS ?? '60000', 10) / 1000),
        });
        return;
      }

      // ── CIRCUIT BREAKER — CROSS-REQUEST (Redis) ──────────────────────────
      const sessionKey = resolveSessionKey(req.headers as Record<string, string | string[] | undefined>, req.ip ?? 'unknown');
      const crossResult = await checkCrossRequestLimits(sessionKey, tokensReceived, cbOptions);
      if (crossResult.tripped) {
        console.warn(`[killcord/cb] Cross-request limit hit. session=${sessionKey} traceId=${traceId} reason=${crossResult.reason} detail=${crossResult.detail}`);
        fireWebhook({ event: 'circuit_breaker_tripped', traceId, sessionKey, ...crossResult, endpoint: '/v1/messages', ts: new Date().toISOString() });
        res.status(429).json({
          error:       'circuit_breaker_tripped',
          reason:      crossResult.reason,
          detail:      crossResult.detail,
          retry_after: Math.ceil(parseInt(process.env.CB_WINDOW_MS ?? '60000', 10) / 1000),
        });
        return;
      }

      // ── COMPLEXITY CLASSIFICATION ────────────────────────────────────────
      const lastUserMsg = extractAnthropicPrompt(body.messages);
      const complexity  = classifyRequest(lastUserMsg, toolsReceived, body.messages.length);
      res.setHeader('X-Killcord-Complexity', complexity.complexity);
      res.setHeader('X-Killcord-Complexity-Score', String(complexity.score));

      // ── PII REDACTION ────────────────────────────────────────────────────
      // Mutate message text in-place before forwarding so credentials and
      // personal data never leave the internal network.
      redactAnthropicMessages(body.messages);

      // ── AUTO-ROUTE: simple requests → local engine ───────────────────────
      if (shouldAutoRoute(complexity.complexity) && !LOCAL_MODELS.has(body.model ?? '')) {
        console.log(`[killcord] Auto-routing simple request to local engine. session=${sessionKey} score=${complexity.score} reasons=${complexity.reasons.join(',')}`);
        res.on('finish', () =>
          setImmediate(() =>
            record({ ts: Date.now(), traceId, model: `local-auto:${body.model ?? 'unknown'}`, toolsReceived, toolsForwarded: toolsReceived, tokensReceived, tokensForwarded: tokensReceived })
          )
        );
        await proxyRequest(`${LOCAL_ENGINE_URL}/v1/messages`, req, body, res);
        return;
      }

      // ── LOCAL ENGINE BYPASS ──────────────────────────────────────────────
      // Air-gapped models skip semantic filtering (no cloud billing to reduce).
      if (LOCAL_MODELS.has(body.model ?? '')) {
        res.on('finish', () =>
          setImmediate(() =>
            record({
              ts: Date.now(), traceId,
              model:          body.model ?? 'unknown',
              toolsReceived,  toolsForwarded:  toolsReceived,
              tokensReceived, tokensForwarded: tokensReceived,
            })
          )
        );
        await proxyRequest(`${LOCAL_ENGINE_URL}/v1/messages`, req, body, res);
        return;
      }

      // ── SEMANTIC FILTER ──────────────────────────────────────────────────
      if (Array.isArray(body.tools) && body.tools.length > 0) {
        const prompt = extractAnthropicPrompt(body.messages);
        if (prompt) body.tools = await filterTools(prompt, body.tools);
      }

      const toolsForwarded  = Array.isArray(body.tools) ? body.tools.length : 0;
      const tokensForwarded = estimateTokens(body.tools ?? []);

      // ── ASYNC ROI LOGGING ────────────────────────────────────────────────
      // Fires after the response is flushed (res 'finish') then deferred
      // behind remaining I/O (setImmediate) — zero impact on latency.
      res.on('finish', () =>
        setImmediate(() =>
          record({
            ts: Date.now(), traceId,
            model: body.model ?? 'unknown',
            toolsReceived,  toolsForwarded,
            tokensReceived, tokensForwarded,
          })
        )
      );

      await proxyRequest(`${upstreamBase}/v1/messages`, req, body, res);

    } catch (filterErr) {
      // ── FAIL-OPEN CIRCUIT BREAKER ────────────────────────────────────────
      // Any internal failure triggers an immediate bypass: restore original
      // tools and forward the raw request so the caller is never blocked.
      const errMsg = filterErr instanceof Error ? filterErr.message : String(filterErr);
      console.warn('[killcord] Circuit breaker triggered — bypassing filter.', errMsg);

      // ── WEBHOOK ALERT ─────────────────────────────────────────────────────
      // Silently notify ops via WEBHOOK_URL if configured. The proxy does not
      // wait for delivery — a slow or unreachable webhook cannot affect latency.
      fireWebhook({
        event:     'circuit_breaker_triggered',
        traceId,
        endpoint:  '/v1/messages',
        error:     errMsg,
        ts:        new Date().toISOString(),
      });

      body.tools = originalTools as typeof body.tools;
      try {
        await proxyRequest(`${upstreamBase}/v1/messages`, req, body, res);
      } catch (fwdErr) {
        next(fwdErr);
      }
    }
  };
}

export function openaiFilterMiddleware(upstreamBase: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const traceId = randomUUID();
    res.setHeader('X-Killcord-Trace-Id', traceId);

    const body = req.body as OpenAIRequest;
    const originalTools = Array.isArray(body.tools) ? [...body.tools] : body.tools;

    const toolsReceived  = Array.isArray(body.tools) ? body.tools.length : 0;
    const tokensReceived = estimateTokens(body.tools ?? []);

    try {
      if (!Array.isArray(body.messages)) {
        await proxyRequest(`${upstreamBase}/v1/chat/completions`, req, body, res);
        return;
      }

      // ── CIRCUIT BREAKER — HISTORY SCAN ──────────────────────────────────
      const cbOptions: CBOptions = parseCBHeaders(req.headers as Record<string, string | string[] | undefined>);
      const historyResult: CircuitBreakerResult = scanHistoryForLoop(
        body.messages as unknown as Array<Record<string, unknown>>,
        cbOptions,
      );
      if (historyResult.tripped) {
        const sessionKey = resolveSessionKey(req.headers as Record<string, string | string[] | undefined>, req.ip ?? 'unknown');
        console.warn(`[killcord/cb] History loop detected. session=${sessionKey} traceId=${traceId} reason=${historyResult.reason} detail=${historyResult.detail}`);
        fireWebhook({ event: 'circuit_breaker_tripped', traceId, sessionKey, ...historyResult, endpoint: '/v1/chat/completions', ts: new Date().toISOString() });
        res.status(429).json({
          error:       'circuit_breaker_tripped',
          reason:      historyResult.reason,
          detail:      historyResult.detail,
          retry_after: Math.ceil(parseInt(process.env.CB_WINDOW_MS ?? '60000', 10) / 1000),
        });
        return;
      }

      // ── CIRCUIT BREAKER — CROSS-REQUEST (Redis) ──────────────────────────
      const sessionKey = resolveSessionKey(req.headers as Record<string, string | string[] | undefined>, req.ip ?? 'unknown');
      const crossResult = await checkCrossRequestLimits(sessionKey, tokensReceived, cbOptions);
      if (crossResult.tripped) {
        console.warn(`[killcord/cb] Cross-request limit hit. session=${sessionKey} traceId=${traceId} reason=${crossResult.reason} detail=${crossResult.detail}`);
        fireWebhook({ event: 'circuit_breaker_tripped', traceId, sessionKey, ...crossResult, endpoint: '/v1/chat/completions', ts: new Date().toISOString() });
        res.status(429).json({
          error:       'circuit_breaker_tripped',
          reason:      crossResult.reason,
          detail:      crossResult.detail,
          retry_after: Math.ceil(parseInt(process.env.CB_WINDOW_MS ?? '60000', 10) / 1000),
        });
        return;
      }

      // ── COMPLEXITY CLASSIFICATION ────────────────────────────────────────
      const userMsg    = [...body.messages].reverse().find(m => m.role === 'user');
      const prompt     = typeof userMsg?.content === 'string' ? userMsg.content : '';
      const complexity = classifyRequest(prompt, toolsReceived, body.messages.length);
      res.setHeader('X-Killcord-Complexity', complexity.complexity);
      res.setHeader('X-Killcord-Complexity-Score', String(complexity.score));

      redactOpenAIMessages(body.messages);

      // ── AUTO-ROUTE: simple requests → local engine ───────────────────────
      if (shouldAutoRoute(complexity.complexity) && !LOCAL_MODELS.has(body.model ?? '')) {
        console.log(`[killcord] Auto-routing simple request to local engine. session=${sessionKey} score=${complexity.score}`);
        res.on('finish', () =>
          setImmediate(() =>
            record({ ts: Date.now(), traceId, model: `local-auto:${body.model ?? 'unknown'}`, toolsReceived, toolsForwarded: toolsReceived, tokensReceived, tokensForwarded: tokensReceived })
          )
        );
        await proxyRequest(`${LOCAL_ENGINE_URL}/v1/chat/completions`, req, body, res);
        return;
      }

      // ── LOCAL ENGINE BYPASS ──────────────────────────────────────────────
      if (LOCAL_MODELS.has(body.model ?? '')) {
        res.on('finish', () =>
          setImmediate(() =>
            record({
              ts: Date.now(), traceId,
              model:          body.model ?? 'unknown',
              toolsReceived,  toolsForwarded:  toolsReceived,
              tokensReceived, tokensForwarded: tokensReceived,
            })
          )
        );
        await proxyRequest(`${LOCAL_ENGINE_URL}/v1/chat/completions`, req, body, res);
        return;
      }

      if (Array.isArray(body.tools) && body.tools.length > 0) {
        const userMsg = [...body.messages].reverse().find(m => m.role === 'user');
        const prompt  = typeof userMsg?.content === 'string' ? userMsg.content : '';
        const mcpTools: MCPTool[] = body.tools.map(t => ({
          name:        t.function.name,
          description: t.function.description ?? t.function.name,
        }));
        const filtered = await filterTools(prompt, mcpTools);
        const keep     = new Set(filtered.map(t => t.name));
        body.tools     = body.tools.filter(t => keep.has(t.function.name));
      }

      const toolsForwarded  = Array.isArray(body.tools) ? body.tools.length : 0;
      const tokensForwarded = estimateTokens(body.tools ?? []);

      res.on('finish', () =>
        setImmediate(() =>
          record({
            ts: Date.now(), traceId,
            model: body.model ?? 'unknown',
            toolsReceived,  toolsForwarded,
            tokensReceived, tokensForwarded,
          })
        )
      );

      await proxyRequest(`${upstreamBase}/v1/chat/completions`, req, body, res);

    } catch (filterErr) {
      const errMsg = filterErr instanceof Error ? filterErr.message : String(filterErr);
      console.warn('[killcord] Circuit breaker triggered — bypassing filter.', errMsg);

      fireWebhook({
        event:    'circuit_breaker_triggered',
        traceId,
        endpoint: '/v1/chat/completions',
        error:    errMsg,
        ts:       new Date().toISOString(),
      });

      body.tools = originalTools as typeof body.tools;
      try {
        await proxyRequest(`${upstreamBase}/v1/chat/completions`, req, body, res);
      } catch (fwdErr) {
        next(fwdErr);
      }
    }
  };
}
