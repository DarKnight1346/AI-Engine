import type { LLMTier } from '@ai-engine/shared';
import type { ChatExecutorOptions, ChatStreamEvent, ChatStreamCallback } from './chat-executor.js';
import { ChatExecutor } from './chat-executor.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SubAgentTask {
  /** Unique identifier for this task (referenced in dependsOn) */
  id: string;
  /** Human-readable title for the task / report section */
  title: string;
  /** Detailed description of what the sub-agent should accomplish */
  description: string;
  /** IDs of tasks that must complete before this one starts */
  dependsOn?: string[];
  /** Model tier override: 'fast' (Haiku), 'standard' (Sonnet), 'heavy' (Opus) */
  tier?: LLMTier;
  /** Hints for which tools to discover (passed in the system prompt) */
  toolHints?: string[];
}

export interface SubAgentResult {
  taskId: string;
  title: string;
  success: boolean;
  /** The sub-agent's findings (markdown content) */
  content: string;
  /** Additional sections discovered during research */
  addedSections?: Array<{ title: string; content: string }>;
  /** Names of tools the sub-agent executed */
  toolsUsed: string[];
  /** Number of LLM iterations the sub-agent used */
  iterations: number;
  /** Which model tier was actually used */
  modelUsed: LLMTier;
}

/** Options for creating and running a sub-agent */
export interface SubAgentOptions {
  /** Parent executor's options (used to create the child ChatExecutor) */
  parentOptions: ChatExecutorOptions;
  /** Callback for streaming events (progress updates) */
  onEvent?: (taskId: string, event: ChatStreamEvent) => void;
}

/** Callback for DAG-level progress events */
export interface DagProgressCallback {
  onTaskStart: (taskId: string, title: string, tier: LLMTier) => void;
  onTaskComplete: (taskId: string, title: string, success: boolean, completed: number, total: number) => void;
  onSectionAdded: (section: { id: string; title: string; content: string }) => void;
}

// ---------------------------------------------------------------------------
// Shared Blackboard
// ---------------------------------------------------------------------------

/**
 * Simple in-memory key-value store shared across all sub-agents in a
 * single delegation round. Provides full content for explicit dependencies
 * and condensed summaries for cross-pollination between independent tasks.
 */
export class Blackboard {
  private entries = new Map<string, { taskTitle: string; content: string; completedAt: number }>();

  write(taskId: string, content: string, taskTitle: string): void {
    this.entries.set(taskId, { taskTitle, content, completedAt: Date.now() });
  }

  read(taskId: string): string | undefined {
    return this.entries.get(taskId)?.content;
  }

  readAll(): Array<{ taskId: string; taskTitle: string; content: string }> {
    return Array.from(this.entries.entries()).map(([taskId, entry]) => ({
      taskId,
      taskTitle: entry.taskTitle,
      content: entry.content,
    }));
  }

  /**
   * Produce a condensed summary of all completed work so far.
   * Each entry is truncated to keep the total context manageable.
   */
  summarize(maxCharsPerEntry = 500): string {
    if (this.entries.size === 0) return '';

    const lines: string[] = [];
    for (const [taskId, entry] of this.entries) {
      const truncated = entry.content.length > maxCharsPerEntry
        ? entry.content.slice(0, maxCharsPerEntry) + '...'
        : entry.content;
      lines.push(`- **${entry.taskTitle}** (${taskId}): ${truncated}`);
    }
    return lines.join('\n');
  }

  get size(): number {
    return this.entries.size;
  }
}

// ---------------------------------------------------------------------------
// Model Tier Auto-Selection
// ---------------------------------------------------------------------------

const HEAVY_SIGNALS = ['synthesize', 'analyze deeply', 'compare and contrast', 'creative', 'executive summary', 'strategic', 'comprehensive analysis'];
const FAST_SIGNALS = ['list', 'extract', 'lookup', 'fetch', 'format', 'count', 'simple', 'summarize briefly', 'check if'];

/**
 * Automatically select the most cost-effective model tier for a sub-agent task
 * based on heuristics about the task description.
 */
export function autoSelectTier(task: SubAgentTask): LLMTier {
  // Explicit override takes precedence
  if (task.tier) return task.tier;

  const desc = task.description.toLowerCase();

  if (HEAVY_SIGNALS.some(s => desc.includes(s))) return 'heavy';
  if (FAST_SIGNALS.some(s => desc.includes(s))) return 'fast';

  // Short descriptions with few tool hints are likely simple tasks
  if (desc.length < 80 && (task.toolHints?.length ?? 0) <= 1) return 'fast';

  return 'standard';
}

// ---------------------------------------------------------------------------
// Concurrency Semaphore
// ---------------------------------------------------------------------------

/**
 * Simple counting semaphore for limiting concurrent sub-agent executions.
 * Tasks that exceed the limit are queued and run as slots free up.
 */
export class Semaphore {
  private current = 0;
  private queue: Array<() => void> = [];

  constructor(private max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.current++;
        resolve();
      });
    });
  }

  private release(): void {
    this.current--;
    const next = this.queue.shift();
    if (next) next();
  }
}

// ---------------------------------------------------------------------------
// DAG Topological Sort
// ---------------------------------------------------------------------------

/**
 * Given a list of tasks with `dependsOn` fields, group them into execution
 * levels. Level 0 has no dependencies, level 1 depends only on level 0, etc.
 *
 * Throws if a circular dependency is detected.
 */
export function topologicalSort(tasks: SubAgentTask[]): SubAgentTask[][] {
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const levels: SubAgentTask[][] = [];
  const assigned = new Set<string>();

  // Validate all dependency references exist
  for (const task of tasks) {
    for (const dep of task.dependsOn ?? []) {
      if (!taskMap.has(dep)) {
        throw new Error(`Task "${task.id}" depends on unknown task "${dep}"`);
      }
    }
  }

  let remaining = tasks.length;
  let safetyCounter = 0;
  const maxLevels = tasks.length + 1; // Can't have more levels than tasks

  while (remaining > 0 && safetyCounter < maxLevels) {
    safetyCounter++;

    // Find all tasks whose dependencies are fully satisfied
    const level: SubAgentTask[] = [];
    for (const task of tasks) {
      if (assigned.has(task.id)) continue;
      const deps = task.dependsOn ?? [];
      if (deps.every(d => assigned.has(d))) {
        level.push(task);
      }
    }

    if (level.length === 0) {
      // No progress — must be a cycle
      const unresolved = tasks.filter(t => !assigned.has(t.id)).map(t => t.id);
      throw new Error(`Circular dependency detected among tasks: ${unresolved.join(', ')}`);
    }

    levels.push(level);
    for (const task of level) {
      assigned.add(task.id);
    }
    remaining -= level.length;
  }

  return levels;
}

// ---------------------------------------------------------------------------
// Context Builder
// ---------------------------------------------------------------------------

/**
 * Build the context string injected into a sub-agent's system prompt.
 * Includes full output from explicit dependencies and a condensed
 * blackboard summary for cross-pollination.
 */
function buildContext(task: SubAgentTask, blackboard: Blackboard): string {
  const parts: string[] = [];

  // Explicit dependency outputs (full content)
  const deps = task.dependsOn ?? [];
  if (deps.length > 0) {
    parts.push('## Prerequisites — Completed Task Results\n');
    for (const depId of deps) {
      const content = blackboard.read(depId);
      if (content) {
        const allEntries = blackboard.readAll();
        const entry = allEntries.find(e => e.taskId === depId);
        const title = entry?.taskTitle ?? depId;
        parts.push(`### ${title}\n${content}\n`);
      }
    }
  }

  // Blackboard summary (condensed, excludes explicit dependencies)
  const allEntries = blackboard.readAll();
  const otherEntries = allEntries.filter(e => !deps.includes(e.taskId));
  if (otherEntries.length > 0) {
    parts.push('## Other Completed Work (for reference)\n');
    parts.push(blackboard.summarize(400));
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Sub-Agent System Prompt Builder
// ---------------------------------------------------------------------------

function buildSubAgentSystemPrompt(task: SubAgentTask, context: string): string {
  const toolHintSection = task.toolHints && task.toolHints.length > 0
    ? `\n\nSuggested tools to discover: ${task.toolHints.join(', ')}`
    : '';

  return `You are a specialist research agent working on a focused task as part of a larger report.

## Your Assignment
**${task.title}**
${task.description}

## Instructions
1. Use discover_tools to find relevant tools for your task.
2. Use execute_tool to gather data and information.
3. Be thorough but focused — your task is specific, not open-ended.
4. Return your findings as well-structured markdown.
5. If you discover important related topics not in your assignment, note them under a "## Additional Findings" section.
6. Do NOT use delegate_tasks or ask_user — you are a sub-agent, not an orchestrator.
${toolHintSection}
${context ? '\n---\n' + context : ''}

## Output Format
Write your findings directly. Use markdown headings, bullet points, and tables where appropriate.
Do not include meta-commentary about your research process — just present the findings.

### Data Visualization
When presenting data, use these special code block formats for rich rendering:

**Charts** — wrap a JSON spec in a \`\`\`chart code block:
\`\`\`chart
{
  "type": "bar",
  "title": "Monthly Revenue",
  "data": [{"month": "Jan", "revenue": 4000}, {"month": "Feb", "revenue": 3000}],
  "xKey": "month",
  "yKeys": ["revenue"]
}
\`\`\`
Supported chart types: "bar", "line", "pie", "area", "radar".
For pie charts, use "nameKey" and "valueKey" instead of "xKey"/"yKeys".

**Diagrams** — use \`\`\`mermaid code blocks for flowcharts, sequences, etc.:
\`\`\`mermaid
graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Action]
    B -->|No| D[End]
\`\`\`

Use charts ONLY when you have 3+ data points and a visual pattern (trend, comparison, distribution) communicates something text alone cannot. Most data is better presented inline or in a small table. Never chart for decoration.`;
}

// ---------------------------------------------------------------------------
// Run a Single Sub-Agent
// ---------------------------------------------------------------------------

/**
 * Create and execute a single sub-agent ChatExecutor for a focused task.
 * Returns the sub-agent's findings and metadata.
 */
export async function runSubAgent(
  task: SubAgentTask,
  context: string,
  options: SubAgentOptions,
): Promise<SubAgentResult> {
  const tier = autoSelectTier(task);
  const systemPrompt = buildSubAgentSystemPrompt(task, context);

  // Create a focused ChatExecutor for this sub-task
  const executorOptions: ChatExecutorOptions = {
    llm: options.parentOptions.llm,
    toolConfig: options.parentOptions.toolConfig,
    maxIterations: 10, // Sub-agents get fewer iterations
    tier,
    searchMemory: options.parentOptions.searchMemory,
    userId: options.parentOptions.userId,
    teamId: options.parentOptions.teamId,
    sessionId: options.parentOptions.sessionId,
    nodeId: options.parentOptions.nodeId ?? 'dashboard',
    agentId: `sub-agent:${task.id}`,
    serperApiKey: options.parentOptions.serperApiKey,
    xaiApiKey: options.parentOptions.xaiApiKey,
    dataForSeoLogin: options.parentOptions.dataForSeoLogin,
    dataForSeoPassword: options.parentOptions.dataForSeoPassword,
    workerDispatcher: options.parentOptions.workerDispatcher,
    // No backgroundTaskCallback — sub-agents run synchronously
    // No additionalTools — sub-agents use standard tool discovery
  };

  const executor = new ChatExecutor(executorOptions);

  const toolsUsed: string[] = [];

  // Track tool usage through streaming events
  const onEvent: ChatStreamCallback = (event) => {
    if (event.type === 'tool_call_end' && event.success) {
      toolsUsed.push(event.name);
    }
    // Forward events if the caller wants them
    options.onEvent?.(task.id, event);
  };

  try {
    const result = await executor.executeStreaming(
      [{ role: 'user', content: `Please complete the following research task:\n\n**${task.title}**: ${task.description}` }],
      systemPrompt,
      onEvent,
    );

    // Check for additional findings sections
    const addedSections: Array<{ title: string; content: string }> = [];
    const additionalMatch = result.content.match(/## Additional Findings\s*\n([\s\S]+?)(?=\n## |$)/);
    if (additionalMatch) {
      addedSections.push({
        title: 'Additional Findings',
        content: additionalMatch[1].trim(),
      });
    }

    return {
      taskId: task.id,
      title: task.title,
      success: true,
      content: result.content,
      addedSections: addedSections.length > 0 ? addedSections : undefined,
      toolsUsed,
      iterations: result.iterations,
      modelUsed: tier,
    };
  } catch (err: any) {
    console.error(`[SubAgent:${task.id}] Error:`, err.message);
    return {
      taskId: task.id,
      title: task.title,
      success: false,
      content: `Error executing task: ${err.message}`,
      toolsUsed,
      iterations: 0,
      modelUsed: tier,
    };
  }
}

// ---------------------------------------------------------------------------
// DAG Executor
// ---------------------------------------------------------------------------

/**
 * Execute a set of sub-agent tasks organized as a DAG with dependency
 * resolution, shared blackboard, and concurrency control.
 *
 * Tasks are grouped into levels via topological sort and executed level
 * by level. Within each level, tasks run in parallel (up to maxConcurrent).
 */
export async function executeDag(
  tasks: SubAgentTask[],
  options: SubAgentOptions,
  progress?: DagProgressCallback,
  maxConcurrent = 10,
): Promise<SubAgentResult[]> {
  const levels = topologicalSort(tasks);
  const blackboard = new Blackboard();
  const semaphore = new Semaphore(maxConcurrent);
  const results: SubAgentResult[] = [];
  let completedCount = 0;
  const totalCount = tasks.length;

  for (const level of levels) {
    const levelPromises = level.map(task =>
      semaphore.run(async () => {
        const tier = autoSelectTier(task);

        // Notify progress: task starting
        progress?.onTaskStart(task.id, task.title, tier);

        // Build context from the blackboard
        const context = buildContext(task, blackboard);

        // Run the sub-agent
        const result = await runSubAgent(task, context, options);

        // Write output to blackboard for downstream tasks
        if (result.success) {
          blackboard.write(task.id, result.content, task.title);
        }

        completedCount++;

        // Notify progress: task complete
        progress?.onTaskComplete(task.id, task.title, result.success, completedCount, totalCount);

        // Notify about any added sections
        if (result.addedSections) {
          for (const section of result.addedSections) {
            progress?.onSectionAdded({
              id: `${task.id}_addendum_${Date.now()}`,
              title: section.title,
              content: section.content,
            });
          }
        }

        return result;
      })
    );

    const levelResults = await Promise.allSettled(levelPromises);

    for (const settled of levelResults) {
      if (settled.status === 'fulfilled') {
        results.push(settled.value);
      } else {
        // Promise.allSettled shouldn't produce rejections from our code
        // (we catch errors in runSubAgent), but handle it defensively
        console.error('[executeDag] Unexpected rejection:', settled.reason);
      }
    }
  }

  return results;
}
