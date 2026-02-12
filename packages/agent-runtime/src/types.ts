import type { NodeCapabilities, LLMTier } from '@ai-engine/shared';

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;
}

export interface ToolContext {
  nodeId: string;
  agentId: string;
  workItemId?: string;
  capabilities: NodeCapabilities;
}

export interface ToolResult {
  success: boolean;
  output: string;
  data?: Record<string, unknown>;
}

export interface AgentRunnerOptions {
  nodeId: string;
  capabilities: NodeCapabilities;
  llmTier?: LLMTier;
  maxIterations?: number;
}
