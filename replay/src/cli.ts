import fs   from 'fs';
import path  from 'path';
import http  from 'http';
import express from 'express';
import { parseTrace, summarize } from './parse';
import type { TraceStep } from './types';

// Standalone trace viewer. Reads a JSON file containing either a TraceStep[]
// array or a Killcord JSONL trace record. For the integrated experience that
// reads the proxy's trace directory, use `killcord replay` instead.

const PORT = parseInt(process.env.AGENT_REPLAY_PORT ?? '3030', 10);

async function openBrowser(url: string): Promise<void> {
  try {
    const { default: open } = await import('open');
    await open(url);
  } catch {
    // non-fatal — user can open manually
  }
}

function resolveTrace(): { steps: TraceStep[]; source: string } {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: agent-replay <trace.json>');
    console.error('   or: killcord replay [traceId]   (reads the proxy trace directory)');
    process.exit(1);
  }

  const resolved = path.resolve(arg);
  if (!fs.existsSync(resolved)) {
    console.error(`Error: File not found: ${resolved}`);
    process.exit(1);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
  } catch (e) {
    console.error(`Error: Failed to parse JSON from ${resolved}: ${(e as Error).message}`);
    process.exit(1);
  }

  const steps = parseTrace(raw);
  return { steps, source: resolved };
}

function buildApp(steps: TraceStep[]): express.Application {
  const app = express();

  const publicDir = path.join(__dirname, '..', 'public');
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
  }

  app.get('/api/trace', (_req, res) => {
    res.json({ steps, summary: summarize(steps) });
  });

  // Fallback — serve index.html for any non-API route
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

async function main(): Promise<void> {
  const { steps, source } = resolveTrace();
  const summary = summarize(steps);

  const app = buildApp(steps);
  const server = http.createServer(app);

  server.listen(PORT, '127.0.0.1', async () => {
    const url = `http://localhost:${PORT}`;

    console.log('\n  ┌─────────────────────────────────────────┐');
    console.log('  │        agent-replay  v0.1.0             │');
    console.log('  └─────────────────────────────────────────┘\n');
    console.log(`  Trace:    ${source}`);
    console.log(`  Steps:    ${summary.total_steps}   Tokens: ${summary.total_tokens.toLocaleString()}   Latency: ${summary.total_latency_ms}ms`);
    console.log(`  Tools:    ${summary.tool_execution_count}   Loops: ${summary.loop_warnings}   Errors: ${summary.error_count}`);
    console.log(`\n  Viewer:   ${url}\n`);

    await openBrowser(url);
  });

  process.on('SIGTERM', () => server.close(() => process.exit(0)));
  process.on('SIGINT', () => { console.log('\n'); server.close(() => process.exit(0)); });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
