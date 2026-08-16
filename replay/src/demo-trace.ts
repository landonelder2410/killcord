import type { TraceStep } from './types';

export function generateDemoTrace(): TraceStep[] {
  const base = new Date('2026-08-02T10:00:00.000Z');
  const t = (offsetMs: number) => new Date(base.getTime() + offsetMs).toISOString();

  return [
    {
      step: 1,
      timestamp: t(0),
      role: 'system',
      content: 'You are a financial analysis assistant. Use the provided tools to research and summarize stock performance.',
      latency_ms: 0,
      tokens: 42,
      status: 'success',
    },
    {
      step: 2,
      timestamp: t(50),
      role: 'user',
      content: 'Can you analyze the Q2 performance of AAPL and compare it to last quarter?',
      latency_ms: 12,
      tokens: 28,
      status: 'success',
    },
    {
      step: 3,
      timestamp: t(62),
      role: 'assistant',
      content: "I'll fetch the AAPL financial data for you.",
      latency_ms: 843,
      tokens: 95,
      status: 'success',
      tool_calls: [
        {
          id: 'call_001',
          name: 'fetch_stock_data',
          input: { ticker: 'AAPL', period: 'Q2-2026' },
          output: { open: 182.5, close: 194.3, high: 198.1, low: 179.2, volume: '1.2B' },
        },
      ],
    },
    {
      step: 4,
      timestamp: t(905),
      role: 'tool',
      content: '{"open":182.5,"close":194.3,"high":198.1,"low":179.2,"volume":"1.2B"}',
      latency_ms: 220,
      tokens: 0,
      status: 'success',
      tool_calls: [
        {
          id: 'call_001',
          name: 'fetch_stock_data',
          input: { ticker: 'AAPL', period: 'Q2-2026' },
          output: { open: 182.5, close: 194.3, high: 198.1, low: 179.2, volume: '1.2B' },
        },
      ],
    },
    {
      step: 5,
      timestamp: t(1125),
      role: 'assistant',
      content: "Now let me fetch Q1 data for comparison.",
      latency_ms: 761,
      tokens: 88,
      status: 'success',
      tool_calls: [
        {
          id: 'call_002',
          name: 'fetch_stock_data',
          input: { ticker: 'AAPL', period: 'Q1-2026' },
          output: { open: 175.0, close: 183.9, high: 186.4, low: 170.1, volume: '980M' },
        },
      ],
    },
    {
      step: 6,
      timestamp: t(1886),
      role: 'tool',
      content: '{"open":175.0,"close":183.9,"high":186.4,"low":170.1,"volume":"980M"}',
      latency_ms: 198,
      tokens: 0,
      status: 'success',
      tool_calls: [
        {
          id: 'call_002',
          name: 'fetch_stock_data',
          input: { ticker: 'AAPL', period: 'Q1-2026' },
          output: { open: 175.0, close: 183.9, high: 186.4, low: 170.1, volume: '980M' },
        },
      ],
    },
    {
      step: 7,
      timestamp: t(2084),
      role: 'assistant',
      content: "Let me also check analyst sentiment before summarizing.",
      latency_ms: 654,
      tokens: 72,
      status: 'success',
      tool_calls: [
        {
          id: 'call_003',
          name: 'get_analyst_ratings',
          input: { ticker: 'AAPL' },
          output: null,
        },
      ],
    },
    {
      step: 8,
      timestamp: t(2738),
      role: 'tool',
      content: 'Error: Rate limit exceeded for analyst API. Retry after 60s.',
      latency_ms: 45,
      tokens: 0,
      status: 'error',
      tool_calls: [
        {
          id: 'call_003',
          name: 'get_analyst_ratings',
          input: { ticker: 'AAPL' },
          output: { error: 'Rate limit exceeded. Retry after 60s.' },
        },
      ],
    },
    {
      step: 9,
      timestamp: t(2783),
      role: 'assistant',
      content: "Analyst API failed. Retrying immediately.",
      latency_ms: 590,
      tokens: 64,
      status: 'loop',
      tool_calls: [
        {
          id: 'call_004',
          name: 'get_analyst_ratings',
          input: { ticker: 'AAPL' },
          output: null,
        },
      ],
    },
    {
      step: 10,
      timestamp: t(3373),
      role: 'tool',
      content: 'Error: Rate limit exceeded for analyst API. Retry after 60s.',
      latency_ms: 44,
      tokens: 0,
      status: 'error',
      tool_calls: [
        {
          id: 'call_004',
          name: 'get_analyst_ratings',
          input: { ticker: 'AAPL' },
          output: { error: 'Rate limit exceeded. Retry after 60s.' },
        },
      ],
    },
    {
      step: 11,
      timestamp: t(3417),
      role: 'assistant',
      content: "I'll proceed with the data I have. AAPL Q2 2026 vs Q1 2026:\n\n**Q2 2026**: Open $182.50 → Close $194.30 (+6.5%), High $198.10, Volume 1.2B\n**Q1 2026**: Open $175.00 → Close $183.90 (+5.1%), High $186.40, Volume 980M\n\nConclusion: Q2 showed stronger momentum with a higher closing gain (+6.5% vs +5.1%) and 22% more trading volume, suggesting increased investor confidence heading into earnings.",
      latency_ms: 1204,
      tokens: 182,
      status: 'success',
    },
  ];
}
