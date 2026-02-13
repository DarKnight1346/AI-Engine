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

You have persistent memory that spans conversations. Use your tools to recall and store information — never guess when you can look it up.

### Rules
1. **Before saying "I don't know"** → call search_memory first. It searches your profile, semantic memory, and goals in one call.
2. **When the user shares facts about themselves** (name, preferences, accounts, role, etc.) → call update_profile to store it AND store_memory for broader context.
3. **When the user asks about past context** → call search_memory. Don't rely on the current conversation alone.
4. **Store important information proactively** via store_memory — decisions, user preferences, project context. Use scope "personal" for user-specific data.
5. **Discover additional tools** via discover_tools → execute_tool when you need capabilities beyond memory.
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
