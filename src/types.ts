export interface MCPTool {
  name: string;
  description: string;
  input_schema?: Record<string, unknown>;
}

export interface ContentBlock {
  type: string;
  text?: string;
}

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  tools?: MCPTool[];
  max_tokens?: number;
  system?: string;
  stream?: boolean;
  [key: string]: unknown;
}

export interface OpenAIFunction {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface OpenAITool {
  type: 'function';
  function: OpenAIFunction;
}

export interface OpenAIMessage {
  role: string;
  content: string | null;
}

export interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  tools?: OpenAITool[];
  stream?: boolean;
  [key: string]: unknown;
}

export interface ScoredTool {
  tool: MCPTool;
  score: number;
}
