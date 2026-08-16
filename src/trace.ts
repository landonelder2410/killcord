/**
 * Per-request trace capture.
 *
 * Each proxied request produces one JSONL line written to
 * KILLCORD_TRACE_DIR (default .killcord/traces/). Lines are safe
 * to append concurrently from multiple cluster workers because each
 * worker writes to its own PID-stamped file and uses O_APPEND.
 *
 * Features:
 *  - PII redaction already applied by router.ts before calling writeTrace()
 *  - Previews truncated to 500 characters
 *  - Args hashed (sha256 first-12) — loop patterns visible without full payload
 *  - Files rotated daily; files older than KILLCORD_TRACE_RETENTION_DAYS deleted
 *  - Directory capped at 500 MB; oldest files dropped first
 *  - KILLCORD_TRACE_ENABLED=false disables all writes
 *  - Never throws, never blocks a proxy request
 */
import { createHash }    from 'node:crypto';
import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  existsSync,
}                        from 'node:fs';
import { join, resolve } from 'node:path';

// ── Types ──────────────────────────────────────────────────────────────────

export interface TraceToolCall {
  name:         string;
  inputPreview: string;  // first 500 chars of PII-redacted input
  argsHash:     string;  // sha256 first 12 hex chars
}

export interface KillcordTraceStep {
  index:       number;
  role:        'user' | 'assistant' | 'tool';
  toolCalls:   TraceToolCall[];
  textPreview: string;  // first 500 chars of PII-redacted text
}

export interface KillcordTrace {
  traceId:        string;
  timestamp:      string;
  model:          string;
  latencyMs:      number;
  upstreamStatus: number;
  toolsOffered:   string[];
  toolsForwarded: string[];
  tokensIn:       number;
  tokensOut:      number;
  steps:          KillcordTraceStep[];
  circuitBreaker: {
    tripped:   boolean;
    mechanism: 'exact' | 'semantic' | null;
    reason:    string | null;
    detail:    string | null;
  };
}

// ── Config ─────────────────────────────────────────────────────────────────

const ENABLED        = process.env.KILLCORD_TRACE_ENABLED !== 'false';
const TRACE_DIR      = resolve(process.env.KILLCORD_TRACE_DIR ?? join(process.cwd(), '.killcord', 'traces'));
const RETENTION_DAYS = Math.max(1, parseInt(process.env.KILLCORD_TRACE_RETENTION_DAYS ?? '7', 10) || 7);
const MAX_BYTES      = 500 * 1024 * 1024; // 500 MB

let traceDisabled  = !ENABLED;
let dirInitialized = false;
let lastPruneDay   = '';

// ── Helpers ─────────────────────────────────────────────────────────────────

export function hashArgs(args: unknown): string {
  return createHash('sha256').update(JSON.stringify(args)).digest('hex').slice(0, 12);
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function traceFilePath(): string {
  return join(TRACE_DIR, `traces-${todayUTC()}.pid-${process.pid}.jsonl`);
}

// ── Dir init (once per process) ────────────────────────────────────────────

function ensureDir(): boolean {
  if (dirInitialized) return true;
  try {
    mkdirSync(TRACE_DIR, { recursive: true });
    dirInitialized = true;
    return true;
  } catch (err) {
    console.warn('[killcord/trace] Cannot create trace dir — tracing disabled for this process:', (err as Error).message);
    traceDisabled = true;
    return false;
  }
}

// ── Pruning ────────────────────────────────────────────────────────────────

function pruneOldFiles(): void {
  const today = todayUTC();
  if (lastPruneDay === today) return; // run at most once per UTC day
  lastPruneDay = today;

  try {
    const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;

    // Collect all trace files with their sizes and mtimes.
    let entries = readdirSync(TRACE_DIR)
      .filter(f => f.startsWith('traces-') && f.endsWith('.jsonl'))
      .map(f => {
        try {
          const s = statSync(join(TRACE_DIR, f));
          return { name: f, size: s.size, mtime: s.mtimeMs };
        } catch { return null; }
      })
      .filter((e): e is { name: string; size: number; mtime: number } => e !== null)
      .sort((a, b) => a.mtime - b.mtime); // oldest first

    // Delete files past retention period.
    for (const entry of entries) {
      if (entry.mtime < cutoff) {
        try { unlinkSync(join(TRACE_DIR, entry.name)); } catch { /* ignore */ }
      }
    }

    // Re-read after deletion for accurate size accounting.
    entries = entries.filter(e => {
      try { statSync(join(TRACE_DIR, e.name)); return true; } catch { return false; }
    });

    // Drop oldest files until total size is under MAX_BYTES.
    let totalBytes = entries.reduce((s, e) => s + e.size, 0);
    for (const entry of entries) {
      if (totalBytes <= MAX_BYTES) break;
      try {
        unlinkSync(join(TRACE_DIR, entry.name));
        totalBytes -= entry.size;
      } catch { /* ignore */ }
    }
  } catch (err) {
    console.warn('[killcord/trace] Prune error (non-fatal):', (err as Error).message);
  }
}

// ── Public write API ────────────────────────────────────────────────────────

/**
 * Write one trace record as a single JSONL line. Fire-and-forget from callers
 * — this function never throws. On any write error it logs once and disables
 * tracing for the lifetime of this process.
 */
export function writeTrace(trace: KillcordTrace): void {
  if (traceDisabled) return;
  if (!ensureDir()) return;

  // Prune once per UTC day (cheap — mostly a no-op after the first call).
  pruneOldFiles();

  const line = JSON.stringify(trace) + '\n';

  try {
    // O_APPEND is atomic on POSIX for writes ≤ PIPE_BUF. Cluster workers
    // writing their own PID-stamped files avoids any cross-process collision.
    appendFileSync(traceFilePath(), line, { encoding: 'utf-8', flag: 'a' });
  } catch (err) {
    console.warn('[killcord/trace] Write failed — disabling tracing for this process:', (err as Error).message);
    traceDisabled = true;
  }
}

// ── JSONL reader (used by replay CLI) ──────────────────────────────────────

export interface TraceSummaryLine {
  traceId:        string;
  timestamp:      string;
  model:          string;
  latencyMs:      number;
  stepCount:      number;
  cbTripped:      boolean;
}

/**
 * List recent trace IDs across all JSONL files in the trace dir.
 * Returns entries sorted newest-first.
 */
export function listTraces(dir = TRACE_DIR, limit = 50): TraceSummaryLine[] {
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir)
    .filter(f => f.startsWith('traces-') && f.endsWith('.jsonl'))
    .sort()
    .reverse(); // newest date first

  const results: TraceSummaryLine[] = [];
  for (const file of files) {
    if (results.length >= limit) break;
    const lines = readJSONLFile(join(dir, file));
    for (const line of lines.reverse()) {
      if (results.length >= limit) break;
      const t = parseTraceLine(line);
      if (!t) continue;
      results.push({
        traceId:   t.traceId,
        timestamp: t.timestamp,
        model:     t.model,
        latencyMs: t.latencyMs,
        stepCount: t.steps.length,
        cbTripped: t.circuitBreaker.tripped,
      });
    }
  }
  return results;
}

/**
 * Find a single trace by traceId across all JSONL files.
 */
export function findTrace(traceId: string, dir = TRACE_DIR): KillcordTrace | null {
  if (!existsSync(dir)) return null;

  const files = readdirSync(dir)
    .filter(f => f.startsWith('traces-') && f.endsWith('.jsonl'))
    .sort()
    .reverse(); // search newest first

  for (const file of files) {
    const lines = readJSONLFile(join(dir, file));
    for (const line of lines) {
      const t = parseTraceLine(line);
      if (t?.traceId === traceId) return t;
    }
  }
  return null;
}

function readJSONLFile(path: string): string[] {
  try {
    return require('node:fs').readFileSync(path, 'utf-8').split('\n').filter((l: string) => l.trim());
  } catch { return []; }
}

function parseTraceLine(line: string): KillcordTrace | null {
  try { return JSON.parse(line) as KillcordTrace; } catch { return null; }
}
