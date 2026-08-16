#!/usr/bin/env node
import './structured-log'; // patches console.* to JSON in production — must be first import
import http                                                           from 'node:http';
import cluster                                                        from 'node:cluster';
import os                                                             from 'node:os';
import express, { type Request, type Response, type NextFunction }   from 'express';
import cors                                                           from 'cors';
import helmet                                                         from 'helmet';
import { anthropicFilterMiddleware, openaiFilterMiddleware, warmup } from './router';
import { billingRouter, createWebhookHandler } from './billing';
import {
  loadLicenseState,
  saveLicenseState,
  getLicenseByKey,
  getLicenseStore,
  setLicenseStore,
  type LicenseStore,
} from './license-db';
import {
  getSummary,
  loadState,
  flushState,
  flushStateAsync,
  drainSessionDelta,
  setPersistedBaseline,
  addToPersistedBaseline,
  getPersistedBaseline,
  type StatsAggregate,
} from './logger';
import { rateLimitMiddleware, disconnectRedis } from './rate-limit';
import { disconnectCbRedis }                   from './circuit-breaker';

const PORT                  = parseInt(process.env.PORT                  ?? '8080',  10);
const ANTHROPIC_UPSTREAM    = process.env.ANTHROPIC_UPSTREAM               ?? 'https://api.anthropic.com';
const OPENAI_UPSTREAM       = process.env.OPENAI_UPSTREAM                  ?? 'https://api.openai.com';
const PROXY_RATE_LIMIT_MAX  = parseInt(process.env.PROXY_RATE_LIMIT_MAX    ?? '100',   10);

// Default to one worker per logical CPU; set WORKERS=1 to disable clustering.
const _parsedWorkers = parseInt(process.env.WORKERS ?? '0', 10);
const NUM_WORKERS    = (isNaN(_parsedWorkers) || _parsedWorkers < 1)
  ? os.cpus().length
  : _parsedWorkers;

// ── Admin endpoint authentication ──────────────────────────────────────────
// Guards /health, /roi, /metrics with the single ADMIN_API_KEY env var.

function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const required = process.env.ADMIN_API_KEY;
  if (!required) { next(); return; }

  const provided =
    (req.headers['x-admin-api-key'] as string | undefined)
    ?? (req.query['key'] as string | undefined);

  if (provided === required) { next(); return; }

  res.status(401).json({
    error:   'unauthorized',
    message: 'Provide a valid x-admin-api-key header or ?key= parameter.',
  });
}

// ── Per-user license key authentication ────────────────────────────────────
// Guards /v1/messages and /v1/chat/completions when AETHER_REQUIRE_LICENSE_KEY
// is set to "true". Validates the caller's unique x-aether-key against the
// in-memory license store (populated by Stripe webhook / /api/billing/key).
// Strips the header before forwarding so the upstream LLM never sees it.

function licenseAuth(req: Request, res: Response, next: NextFunction): void {
  if (process.env.AETHER_REQUIRE_LICENSE_KEY !== 'true') { next(); return; }

  const key = (req.headers['x-aether-key'] as string | undefined)?.trim();

  if (!key) {
    res.status(401).json({
      error:   'missing_license_key',
      message: 'Provide your Aether license key via the x-aether-key request header. ' +
               'Get one by subscribing at /api/billing/checkout.',
    });
    return;
  }

  const license = getLicenseByKey(key);

  if (!license) {
    res.status(401).json({
      error:   'invalid_license_key',
      message: 'License key not recognised. Check your key or contact landon@bankdrift.com.',
    });
    return;
  }

  if (license.status === 'revoked') {
    res.status(403).json({
      error:   'license_revoked',
      message: 'Your subscription has ended. Renew at /api/billing/checkout.',
    });
    return;
  }

  // Strip the license key before forwarding — the upstream LLM API has no
  // knowledge of Aether's auth scheme and must not receive this header.
  delete req.headers['x-aether-key'];

  next();
}

// ── Express app factory ────────────────────────────────────────────────────

function createApp(): express.Application {
  const app = express();

  // Respect X-Forwarded-For when deployed behind a load balancer (AWS ALB, Nginx, etc.)
  // so req.ip returns the real client IP for rate limiting. Set TRUST_PROXY=1 for a
  // single-hop proxy layer, or 'loopback' for localhost-only deployments.
  if (process.env.TRUST_PROXY !== undefined) {
    const v = process.env.TRUST_PROXY;
    app.set('trust proxy', isNaN(Number(v)) ? v : Number(v));
  }

  // Security headers — removes X-Powered-By fingerprint and enforces CSP, HSTS,
  // X-Frame-Options, X-Content-Type-Options, and more.
  app.use(helmet());

  // CORS — defaults to localhost-only when ALLOWED_ORIGINS is unset.
  // AI agents making server-to-server calls don't send an Origin header and
  // are unaffected by this restriction; it only gates browser-originated requests.
  const rawOrigins = (process.env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const corsOrigins = rawOrigins.length > 0
    ? rawOrigins
    : ['http://localhost', 'http://localhost:3000', 'http://localhost:8080',
       'http://127.0.0.1', 'http://127.0.0.1:3000', 'http://127.0.0.1:8080'];
  app.use(cors({
    origin:         corsOrigins,
    methods:        ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-api-key', 'x-aether-key'],
  }));

  // Sliding-window rate limiter — shields against looping or broken AI agents.
  // Defaults: 1000 req / 60 s per IP. Tune via RATE_LIMIT_MAX / RATE_LIMIT_WINDOW.
  app.use(rateLimitMiddleware());

  // ── Stripe webhook — MUST be registered before express.json() ─────────────
  // Stripe signature verification requires the unmodified raw request body.
  // express.json() would parse and discard the raw buffer, breaking verification.
  // 64 kb is well above any real Stripe event payload; blocks memory exhaustion.
  app.post(
    '/api/billing/webhook',
    rateLimitMiddleware(15, 60_000, 'webhook'),
    express.raw({ type: 'application/json', limit: '64kb' }),
    createWebhookHandler(),
  );

  // Hard 2 MB cap on incoming JSON bodies — keeps the V8 heap safe if an
  // agent sends an oversized payload. Adjust via BODY_LIMIT env var only if
  // tool schemas genuinely exceed this size.
  app.use(express.json({ limit: process.env.BODY_LIMIT ?? '2mb' }));

  app.get('/health', adminAuth, (_req: Request, res: Response) => {
    res.json({
      status:    'ok',
      version:   '0.1.1',
      upstreams: { anthropic: ANTHROPIC_UPSTREAM, openai: OPENAI_UPSTREAM },
    });
  });

  app.get('/roi',     adminAuth, (_req: Request, res: Response) => res.json(getSummary()));
  app.get('/savings', adminAuth, (_req: Request, res: Response) => res.redirect('/roi'));

  // Prometheus-format metrics — scraped by Datadog, Grafana, or any OTel collector.
  app.get('/metrics', adminAuth, (_req: Request, res: Response) => {
    const s = getSummary();

    const counter = (name: string, help: string, value: number) =>
      `# HELP ${name} ${help}\n# TYPE ${name} counter\n${name} ${value}`;

    const body = [
      counter('aether_requests_proxied_total',
        'Total requests proxied since first start (persisted across restarts).',
        s.requests_proxied),
      counter('aether_tools_received_total',
        'Total MCP tool schemas received across all proxied requests.',
        s.tools_received),
      counter('aether_tools_forwarded_total',
        'Total MCP tool schemas forwarded to the upstream LLM after filtering.',
        s.tools_forwarded),
      counter('aether_tools_stripped_total',
        'Total MCP tool schemas eliminated by semantic similarity filtering.',
        s.tools_stripped),
      counter('aether_tokens_received_total',
        'Estimated input tokens for all tool schemas received (4 chars = 1 token).',
        s.tokens_received),
      counter('aether_tokens_forwarded_total',
        'Estimated input tokens for tool schemas forwarded to the LLM.',
        s.tokens_forwarded),
      counter('aether_tokens_saved_total',
        'Estimated input tokens eliminated by semantic filtering.',
        s.tokens_saved),
    ].join('\n\n');

    res
      .set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
      .send(body + '\n');
  });

  app.post('/v1/messages',         rateLimitMiddleware(PROXY_RATE_LIMIT_MAX, 60_000, 'proxy'), licenseAuth, anthropicFilterMiddleware(ANTHROPIC_UPSTREAM));
  app.post('/v1/chat/completions', rateLimitMiddleware(PROXY_RATE_LIMIT_MAX, 60_000, 'proxy'), licenseAuth, openaiFilterMiddleware(OPENAI_UPSTREAM));

  // Billing — Stripe Checkout Session creation.
  // Intentionally public (no adminAuth): any visitor on the pricing page needs
  // to start a checkout. The allowed-price guard in billing.ts and the global
  // rate limiter provide sufficient protection against abuse.
  app.use('/api/billing', billingRouter());

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[aether] Unhandled error:', err.message);
    if (!res.headersSent) {
      const detail = process.env.NODE_ENV !== 'production' ? err.message : undefined;
      res.status(500).json({ error: 'internal_error', ...(detail ? { detail } : {}) });
    }
  });

  return app;
}

// ── IPC message contract ───────────────────────────────────────────────────

type ClusterMessage =
  | { type: 'roi_delta';        aggregate: StatsAggregate }
  | { type: 'stats_broadcast';  aggregate: StatsAggregate }
  | { type: 'license_upsert';   store:     LicenseStore   }
  | { type: 'license_broadcast'; store:    LicenseStore   }
  | { type: 'shutdown' };

// ── Cluster primary ────────────────────────────────────────────────────────

function runPrimary(): void {
  if (!process.env.ADMIN_API_KEY) {
    console.warn('[aether] WARNING: ADMIN_API_KEY is not set — /roi, /savings, /health are unprotected.');
  }
  if (process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_WEBHOOK_SECRET) {
    console.warn('[aether] WARNING: STRIPE_WEBHOOK_SECRET is not set — Stripe webhooks cannot be verified.');
  }
  if (process.env.AETHER_REQUIRE_LICENSE_KEY === 'true') {
    console.log('[aether] License key enforcement is ENABLED — proxy endpoints require x-aether-key.');
  }

  loadState();
  loadLicenseState();

  console.log(`
╔══════════════════════════════════════════╗
║          Aether Proxy  v0.1.1            ║
╚══════════════════════════════════════════╝

  Cluster mode:   ${NUM_WORKERS} workers
  Listening on    http://localhost:${PORT}
  Anthropic   →   ${ANTHROPIC_UPSTREAM}
  OpenAI      →   ${OPENAI_UPSTREAM}

  ROI dashboard:  http://localhost:${PORT}/roi
  Health check:   http://localhost:${PORT}/health
`);

  for (let i = 0; i < NUM_WORKERS; i++) cluster.fork();

  let primaryShuttingDown = false;

  // Accumulate ROI deltas and license updates from workers; broadcast
  // authoritative snapshots back so every worker stays accurate.
  cluster.on('message', (_worker, msg: unknown) => {
    const m = msg as ClusterMessage;

    if (m?.type === 'roi_delta') {
      addToPersistedBaseline(m.aggregate);
      const updated = getPersistedBaseline();
      for (const w of Object.values(cluster.workers ?? {})) {
        if (w?.isConnected()) {
          w.send({ type: 'stats_broadcast', aggregate: updated } satisfies ClusterMessage);
        }
      }
    }

    if (m?.type === 'license_upsert') {
      setLicenseStore(m.store);
      saveLicenseState();
      for (const w of Object.values(cluster.workers ?? {})) {
        if (w?.isConnected()) {
          w.send({ type: 'license_broadcast', store: m.store } satisfies ClusterMessage);
        }
      }
    }
  });

  // Re-fork workers that crash unexpectedly; ignore clean exits during shutdown.
  cluster.on('exit', (worker, code, signal) => {
    if (primaryShuttingDown) return;
    if (!worker.exitedAfterDisconnect) {
      console.warn(`[aether] Worker ${worker.process.pid} died (${signal ?? code}) — restarting`);
      cluster.fork();
    }
  });

  // Periodic state flush — interval is unref'd so it doesn't delay a clean exit.
  const flushInterval = setInterval(() => {
    flushStateAsync().catch(err => console.error('[aether] Periodic flush error:', err));
  }, 60_000);
  flushInterval.unref();

  function shutdown(signal: string): void {
    if (primaryShuttingDown) return;
    primaryShuttingDown = true;

    const alive = Object.keys(cluster.workers ?? {}).length;
    console.log(`\n[aether] ${signal} — draining ${alive} worker(s)...`);
    clearInterval(flushInterval);

    // Ask each worker to finish in-flight requests and send remaining stats.
    for (const w of Object.values(cluster.workers ?? {})) {
      w?.send({ type: 'shutdown' } satisfies ClusterMessage);
    }

    // Force-kill stragglers after 30 s.
    const forceKill = setTimeout(() => {
      console.warn('[aether] Force-killing remaining workers after 30 s');
      for (const w of Object.values(cluster.workers ?? {})) {
        w?.process.kill('SIGKILL');
      }
    }, 30_000);
    forceKill.unref();

    // Write final state once all workers have exited.
    function tryExit(): void {
      if (Object.keys(cluster.workers ?? {}).length === 0) {
        clearTimeout(forceKill);
        flushState();
        console.log('[aether] Final state flushed. Exiting.');
        process.exit(0);
      }
    }

    cluster.on('exit', tryExit);
    tryExit(); // handle case where no workers were alive at shutdown time
  }

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// ── Cluster worker ─────────────────────────────────────────────────────────

function runWorker(): void {
  // Load the persisted baseline from disk so this worker's /roi shows all
  // historical data without waiting for the first primary broadcast.
  loadState();
  loadLicenseState();

  const app    = createApp();
  const server = http.createServer(app);
  // keepAliveTimeout must exceed the ALB/NLB idle timeout (60 s default).
  // headersTimeout must exceed keepAliveTimeout to avoid a known Node race condition.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout   = 66_000;

  server.listen(PORT, () => {
    console.log(`[aether] Worker ${process.pid} ready on :${PORT}`);
    warmup().catch((err: unknown) => {
      console.warn('[aether] Warmup failed (model will load on first request):', err);
    });
  });

  // Drain session stats to primary every 60 s. .unref() so this timer does not
  // prevent the process from exiting once server.close() drains its connections.
  const statsInterval = setInterval(() => {
    const delta = drainSessionDelta();
    if (delta.requests > 0) {
      process.send?.({ type: 'roi_delta', aggregate: delta } satisfies ClusterMessage);
    }
  }, 60_000);
  statsInterval.unref();

  // Receive updated aggregates and license store snapshots from the primary,
  // plus clean shutdown requests.
  process.on('message', (msg: unknown) => {
    const m = msg as ClusterMessage;
    if (m?.type === 'stats_broadcast') {
      setPersistedBaseline(m.aggregate);
    } else if (m?.type === 'license_broadcast') {
      setLicenseStore(m.store);
    } else if (m?.type === 'shutdown') {
      gracefulClose('primary_shutdown');
    }
  });

  let shuttingDown = false;

  function gracefulClose(reason: string): void {
    if (shuttingDown) return;
    shuttingDown = true;

    clearInterval(statsInterval);

    // Ship any remaining session stats to the primary before closing.
    const remaining = drainSessionDelta();
    if (remaining.requests > 0) {
      process.send?.({ type: 'roi_delta', aggregate: remaining } satisfies ClusterMessage);
    }

    server.close(() => {
      console.log(`[aether] Worker ${process.pid} closed (${reason}).`);
      Promise.all([disconnectRedis(), disconnectCbRedis()])
        .catch(err => console.warn('[aether] Redis disconnect error:', err))
        .finally(() => process.exit(0));
    });

    setTimeout(() => {
      console.error(`[aether] Worker ${process.pid} forced exit after 30 s.`);
      process.exit(1);
    }, 30_000).unref();
  }

  process.on('SIGTERM', () => gracefulClose('SIGTERM'));
  process.on('SIGINT',  () => gracefulClose('SIGINT'));
}

// ── Single-process mode ────────────────────────────────────────────────────

function runSingleProcess(): void {
  if (!process.env.ADMIN_API_KEY) {
    console.warn('[aether] WARNING: ADMIN_API_KEY is not set — /roi, /savings, /health are unprotected.');
  }
  if (process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_WEBHOOK_SECRET) {
    console.warn('[aether] WARNING: STRIPE_WEBHOOK_SECRET is not set — Stripe webhooks cannot be verified.');
  }
  if (process.env.AETHER_REQUIRE_LICENSE_KEY === 'true') {
    console.log('[aether] License key enforcement is ENABLED — proxy endpoints require x-aether-key.');
  }

  loadState();
  loadLicenseState();

  const app    = createApp();
  const server = http.createServer(app);
  server.keepAliveTimeout = 65_000;
  server.headersTimeout   = 66_000;

  server.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════╗
║          Aether Proxy  v0.1.1            ║
╚══════════════════════════════════════════╝

  Listening on  http://localhost:${PORT}
  Anthropic  →  ${ANTHROPIC_UPSTREAM}
  OpenAI     →  ${OPENAI_UPSTREAM}

  ROI dashboard:  http://localhost:${PORT}/roi
  Health check:   http://localhost:${PORT}/health
`);
    warmup().catch((err: unknown) => {
      console.warn('[aether] Warmup failed (model will load on first request):', err);
    });
  });

  const flushInterval = setInterval(() => {
    flushStateAsync().catch(err => console.error('[aether] Periodic flush error:', err));
  }, 60_000);
  flushInterval.unref();

  function shutdown(signal: string): void {
    console.log(`\n[aether] ${signal} received — draining in-flight requests...`);
    clearInterval(flushInterval);

    server.close(() => {
      flushState();
      console.log('[aether] State flushed.');
      Promise.all([disconnectRedis(), disconnectCbRedis()])
        .catch(err => console.warn('[aether] Redis disconnect error:', err))
        .finally(() => {
          console.log('[aether] Exiting cleanly.');
          process.exit(0);
        });
    });

    setTimeout(() => {
      console.error('[aether] Forced exit: connections did not drain within 30 s.');
      process.exit(1);
    }, 30_000).unref();
  }

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// ── Entry point ────────────────────────────────────────────────────────────

if (cluster.isPrimary) {
  if (NUM_WORKERS <= 1) {
    runSingleProcess();
  } else {
    runPrimary();
  }
} else {
  runWorker();
}
