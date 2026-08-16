import { readFileSync, writeFileSync, writeFile } from 'node:fs';
import { join }                                    from 'node:path';

const STATE_FILE = join(process.cwd(), '.aether-state.json');

// ── Types ──────────────────────────────────────────────────────────────────

export interface StatsAggregate {
  requests:        number;
  toolsReceived:   number;
  toolsForwarded:  number;
  tokensReceived:  number;
  tokensForwarded: number;
}

export interface LogEntry {
  ts:              number;
  traceId:         string;
  model:           string;
  toolsReceived:   number;
  toolsForwarded:  number;
  tokensReceived:  number;
  tokensForwarded: number;
}

// ── In-memory state ────────────────────────────────────────────────────────

function zero(): StatsAggregate {
  return { requests: 0, toolsReceived: 0, toolsForwarded: 0, tokensReceived: 0, tokensForwarded: 0 };
}

function addAgg(a: StatsAggregate, b: StatsAggregate): StatsAggregate {
  return {
    requests:        a.requests        + b.requests,
    toolsReceived:   a.toolsReceived   + b.toolsReceived,
    toolsForwarded:  a.toolsForwarded  + b.toolsForwarded,
    tokensReceived:  a.tokensReceived  + b.tokensReceived,
    tokensForwarded: a.tokensForwarded + b.tokensForwarded,
  };
}

// Lifetime totals loaded from disk on startup; in cluster mode the primary
// also folds in worker IPC deltas here so it stays authoritative.
let persistedBaseline: StatsAggregate = zero();

// Stats accumulated since the last drainSessionDelta() call. In cluster mode
// workers drain this every 60 s and ship it to the primary via IPC.
let sessionDelta: StatsAggregate = zero();

const MAX_ENTRIES = 10_000;
const entries: LogEntry[] = [];

export function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 4);
}

export function record(entry: LogEntry): void {
  if (entries.length >= MAX_ENTRIES) entries.shift();
  entries.push(entry);

  sessionDelta.requests++;
  sessionDelta.toolsReceived   += entry.toolsReceived;
  sessionDelta.toolsForwarded  += entry.toolsForwarded;
  sessionDelta.tokensReceived  += entry.tokensReceived;
  sessionDelta.tokensForwarded += entry.tokensForwarded;
}

// ── Persistence ────────────────────────────────────────────────────────────

// Load saved aggregate from disk — call once on process startup.
export function loadState(path = STATE_FILE): void {
  try {
    const raw    = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<StatsAggregate>;
    persistedBaseline = {
      requests:        parsed.requests        ?? 0,
      toolsReceived:   parsed.toolsReceived   ?? 0,
      toolsForwarded:  parsed.toolsForwarded  ?? 0,
      tokensReceived:  parsed.tokensReceived  ?? 0,
      tokensForwarded: parsed.tokensForwarded ?? 0,
    };
  } catch {
    // File absent or malformed — start fresh.
    persistedBaseline = zero();
  }
}

function buildPayload(): StatsAggregate & { lastFlushed: string } {
  return { ...addAgg(persistedBaseline, sessionDelta), lastFlushed: new Date().toISOString() };
}

// Synchronous — safe to call from SIGINT / SIGTERM handlers before process.exit().
export function flushState(path = STATE_FILE): void {
  try {
    writeFileSync(path, JSON.stringify(buildPayload(), null, 2));
  } catch (err) {
    console.error('[aether] State flush failed:', err);
  }
}

// Async — use for the periodic 60-second background write to avoid blocking.
export function flushStateAsync(path = STATE_FILE): Promise<void> {
  return new Promise(resolve => {
    writeFile(path, JSON.stringify(buildPayload(), null, 2), err => {
      if (err) console.error('[aether] Async state flush failed:', err);
      resolve();
    });
  });
}

// ── Cluster coordination ───────────────────────────────────────────────────

// Workers call this to extract stats before sending the IPC message to primary,
// then reset sessionDelta so counts are not double-reported on the next drain.
export function drainSessionDelta(): StatsAggregate {
  const drained = { ...sessionDelta };
  sessionDelta  = zero();
  return drained;
}

// Workers call this when the primary broadcasts its authoritative aggregate.
export function setPersistedBaseline(agg: StatsAggregate): void {
  persistedBaseline = { ...agg };
}

// Primary calls this to fold each worker's drained delta into the master total.
export function addToPersistedBaseline(delta: StatsAggregate): void {
  persistedBaseline = addAgg(persistedBaseline, delta);
}

// Primary calls this to read the current master total before broadcasting.
export function getPersistedBaseline(): StatsAggregate {
  return { ...persistedBaseline };
}

// ── Dynamic pricing ────────────────────────────────────────────────────────

function getPricePerToken(): Record<string, number> {
  const claudeMtok = parseFloat(process.env.CLAUDE_PRICE_PER_MTOK ?? '3.00');
  const gpt4oMtok  = parseFloat(process.env.OPENAI_PRICE_PER_MTOK ?? '2.50');
  return {
    'claude': (isNaN(claudeMtok) ? 3.00 : claudeMtok) / 1_000_000,
    'gpt-4o': (isNaN(gpt4oMtok)  ? 2.50 : gpt4oMtok)  / 1_000_000,
  };
}

export function getSummary() {
  const total       = addAgg(persistedBaseline, sessionDelta);
  const tokensSaved = total.tokensReceived - total.tokensForwarded;

  const prices = getPricePerToken();
  const dollarsSaved: Record<string, string> = {};
  for (const [model, pricePerToken] of Object.entries(prices)) {
    dollarsSaved[model] = `$${(tokensSaved * pricePerToken).toFixed(4)}`;
  }

  return {
    requests_proxied: total.requests,
    tools_received:   total.toolsReceived,
    tools_forwarded:  total.toolsForwarded,
    tools_stripped:   total.toolsReceived - total.toolsForwarded,
    tokens_received:  total.tokensReceived,
    tokens_forwarded: total.tokensForwarded,
    tokens_saved:     tokensSaved,
    dollars_saved:    dollarsSaved,
    pricing_note:     'Prices read from CLAUDE_PRICE_PER_MTOK / OPENAI_PRICE_PER_MTOK env vars (USD/MTok). Defaults: Claude $3.00, GPT-4o $2.50.',
  };
}
