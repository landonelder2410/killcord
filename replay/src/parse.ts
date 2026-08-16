import type { TraceStep, TraceSummary } from './types';

export function parseTrace(raw: unknown): TraceStep[] {
  if (!Array.isArray(raw)) {
    throw new Error('Trace file must contain a JSON array of steps.');
  }

  return raw.map((item: unknown, idx: number) => {
    if (typeof item !== 'object' || item === null) {
      throw new Error(`Step ${idx + 1} is not an object.`);
    }
    const s = item as Record<string, unknown>;
    const role = String(s['role'] ?? 'assistant');
    if (!['system', 'user', 'assistant', 'tool'].includes(role)) {
      throw new Error(`Step ${idx + 1} has unknown role "${role}".`);
    }
    return {
      step: typeof s['step'] === 'number' ? s['step'] : idx + 1,
      timestamp: typeof s['timestamp'] === 'string' ? s['timestamp'] : new Date().toISOString(),
      role: role as TraceStep['role'],
      content: typeof s['content'] === 'string' ? s['content'] : JSON.stringify(s['content'] ?? ''),
      tool_calls: Array.isArray(s['tool_calls']) ? s['tool_calls'] as TraceStep['tool_calls'] : undefined,
      latency_ms: typeof s['latency_ms'] === 'number' ? s['latency_ms'] : undefined,
      tokens: typeof s['tokens'] === 'number' ? s['tokens'] : undefined,
      status: (['success', 'error', 'loop'].includes(String(s['status'])) ? s['status'] : 'success') as TraceStep['status'],
    };
  });
}

export function summarize(steps: TraceStep[]): TraceSummary {
  return {
    total_steps: steps.length,
    total_tokens: steps.reduce((acc, s) => acc + (s.tokens ?? 0), 0),
    total_latency_ms: steps.reduce((acc, s) => acc + (s.latency_ms ?? 0), 0),
    tool_execution_count: steps.filter(s => s.role === 'tool' || (s.tool_calls?.length ?? 0) > 0).length,
    loop_warnings: steps.filter(s => s.status === 'loop').length,
    error_count: steps.filter(s => s.status === 'error').length,
  };
}
