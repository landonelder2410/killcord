export type StepRole = 'system' | 'user' | 'assistant' | 'tool';
export type StepStatus = 'success' | 'error' | 'loop';

export interface TraceStep {
  step: number;
  timestamp: string;
  role: StepRole;
  content: string;
  tool_calls?: ToolCall[];
  latency_ms?: number;
  tokens?: number;
  status: StepStatus;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: unknown;
}

export interface TraceSummary {
  total_steps: number;
  total_tokens: number;
  total_latency_ms: number;
  tool_execution_count: number;
  loop_warnings: number;
  error_count: number;
}
