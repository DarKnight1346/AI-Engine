import type { LLMPool } from '@ai-engine/llm';
import type { ContextBuilder } from '@ai-engine/memory';
import { ToolRegistry } from './tool-registry.js';
import type { AgentRunnerOptions, ToolContext, ToolResult } from './types.js';
import type { LLMMessage, AgentDefinition, LLMToolCall } from '@ai-engine/shared';
import type Redis from 'ioredis';

export interface AgentTaskInput {
  agent: AgentDefinition;
  taskDetails: string;
  workItemId?: string;
  userId?: string;
  teamId?: string;
  sessionId?: string;
  /**
   * Per-execution tools that augment (and override) the global ToolRegistry.
   * Use this for task-scoped tools like browser sessions that must be isolated
   * between concurrent tasks.
   */
  additionalTools?: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    execute: (input: Record<string, unknown>, context: ToolContext) => Promise<{ success: boolean; output: string }>;
  }>;
}

export interface AgentRunResult {
  success: boolean;
  output: string;
  toolCallsCount: number;
  tokensUsed: { input: number; output: number };
  iterations: number;
}

export class AgentRunner {
  private toolRegistry: ToolRegistry;

  constructor(
    private llm: LLMPool,
    private contextBuilder: ContextBuilder,
    private options: AgentRunnerOptions,
    private redis?: Redis
  ) {
    this.toolRegistry = new ToolRegistry();
  }

  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  async run(input: AgentTaskInput): Promise<AgentRunResult> {
    const maxIterations = this.options.maxIterations ?? 100;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let toolCallsCount = 0;

    // Build context with goals and memories
    const context = await this.contextBuilder.buildContext({
      agentRolePrompt: input.agent.rolePrompt,
      userId: input.userId,
      teamId: input.teamId,
      taskDetails: input.taskDetails,
      query: input.taskDetails,
    });

    const toolContext: ToolContext = {
      nodeId: this.options.nodeId,
      agentId: input.agent.id,
      workItemId: input.workItemId,
      capabilities: this.options.capabilities,
    };

    // Build tool definitions for Claude.
    // Merge global tools with per-execution additional tools.
    // Additional tools override global ones if names collide, ensuring
    // per-task browser sessions don't leak across concurrent executions.
    const globalTools = this.toolRegistry.getAll();
    const additionalTools = input.additionalTools ?? [];

    // Build a per-run tool lookup (global + overrides)
    const perRunTools = new Map<string, { name: string; description: string; inputSchema: Record<string, unknown>; execute: (input: Record<string, unknown>, context: ToolContext) => Promise<{ success: boolean; output: string }> }>();
    for (const t of globalTools) {
      perRunTools.set(t.name, t);
    }
    for (const t of additionalTools) {
      perRunTools.set(t.name, t);
    }

    const tools = Array.from(perRunTools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));

    const messages: LLMMessage[] = [
      { role: 'user', content: input.taskDetails },
    ];

    // Emit thinking status
    await this.emitThinkingStatus(input.sessionId, 'thinking', `Processing: ${input.taskDetails.slice(0, 50)}...`);

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const response = await this.llm.call(messages, {
        tier: this.options.llmTier ?? 'standard',
        systemPrompt: context.systemPrompt,
        tools: tools.length > 0 ? tools : undefined,
      });

      totalInputTokens += response.usage.inputTokens;
      totalOutputTokens += response.usage.outputTokens;

      // If no tool calls, we're done
      if (response.toolCalls.length === 0) {
        await this.emitThinkingStatus(input.sessionId, 'idle', '');
        return {
          success: true,
          output: response.content,
          toolCallsCount,
          tokensUsed: { input: totalInputTokens, output: totalOutputTokens },
          iterations: iteration + 1,
        };
      }

      // Process tool calls
      messages.push({
        role: 'assistant',
        content: response.toolCalls.map((tc: LLMToolCall) => ({
          type: 'tool_use' as const,
          id: tc.id,
          name: tc.name,
          input: tc.input,
        })),
      });

      const toolResults: Array<{ type: 'tool_result'; toolUseId: string; content: string }> = [];

      for (const toolCall of response.toolCalls) {
        toolCallsCount++;
        const tool = perRunTools.get(toolCall.name);

        await this.emitThinkingStatus(input.sessionId, 'thinking', `Using tool: ${toolCall.name}...`);

        if (!tool) {
          toolResults.push({
            type: 'tool_result',
            toolUseId: toolCall.id,
            content: `Error: Unknown tool "${toolCall.name}"`,
          });
          continue;
        }

        try {
          const result = await tool.execute(toolCall.input, toolContext);
          toolResults.push({
            type: 'tool_result',
            toolUseId: toolCall.id,
            content: result.output,
          });
        } catch (err: any) {
          toolResults.push({
            type: 'tool_result',
            toolUseId: toolCall.id,
            content: `Error executing tool: ${err.message}`,
          });
        }
      }

      messages.push({
        role: 'user',
        content: toolResults,
      });
    }

    await this.emitThinkingStatus(input.sessionId, 'idle', '');
    return {
      success: false,
      output: 'Agent reached maximum iterations without completing the task.',
      toolCallsCount,
      tokensUsed: { input: totalInputTokens, output: totalOutputTokens },
      iterations: maxIterations,
    };
  }

  private async emitThinkingStatus(sessionId: string | undefined, phase: string, message: string): Promise<void> {
    if (!this.redis || !sessionId) return;
    try {
      await this.redis.publish('thinking:status', JSON.stringify({
        sessionId,
        phase,
        message,
        timestamp: new Date().toISOString(),
      }));
    } catch {
      // Non-critical, don't fail the agent
    }
  }
}
