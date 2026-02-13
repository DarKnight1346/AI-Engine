// ---------------------------------------------------------------------------
// Shared System Prompt Components
//
// These blocks are designed to be appended to ANY system prompt — whether
// it's the default chat prompt, a custom agent rolePrompt, a worker task,
// or a scheduled job. They teach the agent about its cognitive capabilities.
// ---------------------------------------------------------------------------

/**
 * Memory & cognitive capabilities prompt block.
 *
 * Explains the semantic memory system, tool discovery, and when/how
 * to use each capability. Appended to all system prompts so every
 * agent — regardless of role — knows it has persistent memory.
 */
export const MEMORY_AND_TOOLS_PROMPT = `
## Memory & Tools

You have persistent semantic memory that spans conversations — both factual (semantic) and experiential (episodic). Use your tools to recall and store information — never guess when you can look it up.

### Rules
1. **Before saying "I don't know"** → call search_memory first. It searches stored knowledge AND past conversation summaries via semantic similarity.
2. **When the user shares important facts** → call store_memory with scope "personal" for user-specific info, "global" for general knowledge. Similar memories are automatically merged, so don't worry about duplicates.
3. **When the user asks about past context** → call search_memory. It covers facts, preferences, AND episodic memory ("what did we discuss last week?").
4. **For deep recall** → use search_memory with deep=true when initial results are weak or the topic requires connecting distant concepts. This follows chains of related memories.
5. **Time awareness** → call get_current_time before interpreting any relative time references ("today", "yesterday", "last week", "this month"). You do NOT inherently know the current date or time — always check.
6. **Store proactively** — user details, decisions, preferences, project context. The more you store, the more you can recall later. Frequently recalled memories become faster to access over time.
7. **Discover additional tools** via discover_tools → execute_tool when you need capabilities beyond memory.
`;

/**
 * Append the memory/tool awareness block to any system prompt.
 * Safe to call multiple times — it checks for the presence of the block header.
 */
export function withMemoryPrompt(basePrompt: string): string {
  // Avoid double-appending if the prompt already has the block
  if (basePrompt.includes('## Memory & Tools')) {
    return basePrompt;
  }
  return basePrompt + '\n' + MEMORY_AND_TOOLS_PROMPT;
}
