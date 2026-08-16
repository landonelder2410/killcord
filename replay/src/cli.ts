import fs   from 'fs';
import path  from 'path';
import http  from 'http';
import express from 'express';
import { listTraces, findTrace, type KillcordTrace } from '../../src/trace';
import { summarize } from './parse';
import type { TraceStep } from './types';

const PORT      = parseInt(process.env.AGENT_REPLAY_PORT ?? '3030', 10);
const TRACE_DIR = process.env.KILLCORD_TRACE_DIR
  ? path.resolve(process.env.KILLCORD_TRACE_DIR)
  : path.join(process.cwd(), '.killcord', 'traces');

// ── KillcordTrace → TraceStep[] adapter ───────────────────────────────────
// Converts the proxy's per-request KillcordTrace record into the legacy
// TraceStep[] shape that the viewer HTML/API expects.

function toTraceSteps(trace: KillcordTrace): TraceStep[] {
  const steps: TraceStep[] = trace.steps.map((s, i) => {
    const isLast = i === trace.steps.length - 1;
    const cbTripped = trace.circuitBreaker.tripped && isLast;

    const toolCalls: TraceStep['tool_calls'] = s.toolCalls.map(tc => ({
      id:    tc.argsHash,
      name:  tc.name,
      input: { preview: tc.inputPreview },
    }));

    return {
      step:       s.index + 1,
      timestamp:  trace.timestamp,
      role:       s.role,
      content:    s.textPreview || (s.toolCalls.length > 0 ? `[${s.toolCalls.map(tc => tc.name).join(', ')}]` : '(empty)'),
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      latency_ms: isLast ? trace.latencyMs : undefined,
      tokens:     isLast ? (trace.tokensIn + trace.tokensOut) : undefined,
      status:     cbTripped ? 'loop' : 'success',
    };
  });

  // If no steps were captured but the CB tripped, synthesise a synthetic step.
  if (steps.length === 0 && trace.circuitBreaker.tripped) {
    steps.push({
      step:      1,
      timestamp: trace.timestamp,
      role:      'assistant',
      content:   trace.circuitBreaker.detail ?? 'Circuit breaker tripped',
      status:    'loop',
    });
  }

  return steps;
}

// ── async browser open ─────────────────────────────────────────────────────

async function openBrowser(url: string): Promise<void> {
  try {
    const { default: open } = await import('open');
    await open(url);
  } catch {
    // non-fatal — user can open manually
  }
}

// ── list command ───────────────────────────────────────────────────────────

function runList(): void {
  const traces = listTraces(TRACE_DIR, 50);

  if (traces.length === 0) {
    console.log(`\n  No traces found in ${TRACE_DIR}`);
    console.log('  Run `killcord dev` and send a request to generate traces.\n');
    return;
  }

  console.log('\n  ┌─────────────────────────────────────────────────────────────────────┐');
  console.log('  │  Killcord Traces                                                    │');
  console.log(`  │  Directory: ${TRACE_DIR.padEnd(58)}│`);
  console.log('  └─────────────────────────────────────────────────────────────────────┘\n');

  const COL = { id: 36, time: 24, model: 20, latency: 10, steps: 6, cb: 8 };
  const header = [
    'Trace ID'.padEnd(COL.id),
    'Time'.padEnd(COL.time),
    'Model'.padEnd(COL.model),
    'Latency'.padEnd(COL.latency),
    'Steps'.padEnd(COL.steps),
    'CB',
  ].join(' ');

  console.log('  ' + header);
  console.log('  ' + '─'.repeat(header.length));

  for (const t of traces) {
    const cb = t.cbTripped ? '\x1b[33m⚠ TRIP\x1b[0m' : '\x1b[32mok\x1b[0m';
    const row = [
      t.traceId.padEnd(COL.id),
      t.timestamp.slice(0, 23).padEnd(COL.time),
      t.model.slice(0, 19).padEnd(COL.model),
      `${t.latencyMs}ms`.padEnd(COL.latency),
      String(t.stepCount).padEnd(COL.steps),
      cb,
    ].join(' ');
    console.log('  ' + row);
  }

  console.log(`\n  Run: killcord replay <traceId>   to open the viewer\n`);
}

// ── viewer server ──────────────────────────────────────────────────────────

function buildApp(steps: TraceStep[]): express.Application {
  const app = express();

  const publicDir = path.join(__dirname, '..', 'public');
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
  }

  app.get('/api/trace', (_req, res) => {
    res.json({ steps, summary: summarize(steps) });
  });

  app.get('*', (_req, res) => {
    const indexPath = path.join(publicDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).send('index.html not found');
    }
  });

  return app;
}

async function runViewer(traceId: string): Promise<void> {
  const trace = findTrace(traceId, TRACE_DIR);

  if (!trace) {
    console.error(`\n  Error: trace "${traceId}" not found in ${TRACE_DIR}`);
    console.error('  Run `killcord replay` to list available traces.\n');
    process.exit(1);
  }

  const steps   = toTraceSteps(trace);
  const summary = summarize(steps);
  const app     = buildApp(steps);
  const server  = http.createServer(app);

  server.listen(PORT, '127.0.0.1', async () => {
    const url = `http://localhost:${PORT}`;

    console.log('\n  ┌─────────────────────────────────────────┐');
    console.log('  │        Killcord Replay  v0.1.0          │');
    console.log('  └─────────────────────────────────────────┘\n');
    console.log(`  Trace:    ${trace.traceId}`);
    console.log(`  Model:    ${trace.model}   Status: ${trace.upstreamStatus}   Latency: ${trace.latencyMs}ms`);
    console.log(`  Steps:    ${summary.total_steps}   Tokens: ${summary.total_tokens.toLocaleString()}`);
    console.log(`  Tools:    ${summary.tool_execution_count}   Loops: ${summary.loop_warnings}   Errors: ${summary.error_count}`);
    if (trace.circuitBreaker.tripped) {
      console.log(`\n  ⚠  CB TRIPPED  mechanism=${trace.circuitBreaker.mechanism}  ${trace.circuitBreaker.detail}`);
    }
    console.log(`\n  Viewer:   ${url}\n`);

    await openBrowser(url);
  });

  process.on('SIGTERM', () => server.close(() => process.exit(0)));
  process.on('SIGINT', () => { console.log('\n'); server.close(() => process.exit(0)); });
}

// ── Entry point ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const arg = process.argv[2];

  if (!arg) {
    runList();
    return;
  }

  await runViewer(arg);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
