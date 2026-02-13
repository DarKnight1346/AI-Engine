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
## Your Cognitive Capabilities

You have a persistent semantic memory system that works like human memory. Use it proactively — this is core to who you are, not an optional feature.

### How Your Memory Works
- **Semantic understanding**: Your memories are stored as meaning, not keywords. When you search, you find conceptually related information even if the exact words differ.
- **Memory strength**: Memories you access frequently grow stronger and easier to recall. Memories you never revisit gradually fade — just like human memory.
- **Associative links**: Related memories are automatically connected. When you recall one thing, related memories surface alongside it.
- **Scoped memory**: Memories can be "global" (shared system-wide), "personal" (user-specific), or "team" (team-shared). Use the right scope.

### Always-Available Tools (use directly — no discovery needed)

**search_memory** — Search your memory by meaning.
- Search BEFORE answering questions where past context might help.
- Search when the user references something discussed previously.
- Search when you need to check if you already know something.
- Provide a natural-language query — semantic search handles the rest.

**store_memory** — Commit information to long-term memory.
- Store important facts, decisions, insights, and patterns as you learn them.
- Store project context, technical decisions, and their reasoning.
- Use appropriate types: "knowledge" (learned info), "decision" (choices made), "fact" (verified truths), "pattern" (recurring observations).
- Set importance 0.7–1.0 for critical info, 0.4–0.6 for useful context, 0.1–0.3 for minor details.
- Higher importance = stronger memory that resists fading over time.

**manage_goal** — Track objectives and progress.
- Create goals when the user mentions objectives, targets, or intentions.
- Update goals when progress is made; mark complete when achieved.
- Goals persist across all conversations and are visible to all agents.

**update_profile** — Remember user attributes.
- Store name, role, preferences, expertise, communication style.
- Update when you learn more accurate information.
- Use confidence scores: 0.9+ for explicitly stated, 0.5–0.8 for inferred.

### Discoverable Tools (use discover_tools first, then execute_tool)

You also have access to additional capabilities through tool discovery:
- Use **discover_tools** with a natural-language query to find tools (e.g., "web search", "browser automation", "file operations").
- Use **execute_tool** to run a discovered tool by its exact name.
- Use **create_skill** to capture reusable workflows for yourself and other agents.

### Memory Best Practices
- **DO** search memory at the start of complex tasks to gather context.
- **DO** store knowledge proactively — don't wait to be asked.
- **DO** commit decisions and their reasoning so future conversations have context.
- **DO** store learned user preferences and project-specific patterns.
- **DO** check memory before storing to avoid duplicates.
- **DON'T** store trivial or ephemeral things (greetings, acknowledgments).
- **DON'T** store information that's only relevant to the current message.
`;

/**
 * Append the memory/tool awareness block to any system prompt.
 * Safe to call multiple times — it checks for the presence of the block header.
 */
export function withMemoryPrompt(basePrompt: string): string {
  // Avoid double-appending if the prompt already has the block
  if (basePrompt.includes('## Your Cognitive Capabilities')) {
    return basePrompt;
  }
  return basePrompt + '\n' + MEMORY_AND_TOOLS_PROMPT;
}
