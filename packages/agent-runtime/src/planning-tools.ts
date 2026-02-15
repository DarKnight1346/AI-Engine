import type { Tool } from './types.js';
import { ProjectMemoryService } from '@ai-engine/memory';

/**
 * Planning Mode Tools
 * 
 * Read-only tools for gathering information during project planning.
 * These tools DO NOT have access to file system, code execution, or build operations.
 */

/**
 * Create planning-specific tools
 */
export function createPlanningTools(projectMemoryService: ProjectMemoryService, projectId: string): Tool[] {
  return [
    // ============================================================
    // Memory & Context Tools
    // ============================================================
    {
      name: 'recall_project_context',
      description: 'Retrieve relevant project requirements, decisions, and context from memory based on a query',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'What information to recall (e.g., "authentication requirements", "database decisions")',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of memories to retrieve (default: 15)',
            default: 15,
          },
        },
        required: ['query'],
      },
      execute: async (input: Record<string, unknown>) => {
        const query = input.query as string;
        const limit = (input.limit as number) || 15;
        
        const memories = await projectMemoryService.getRelevantContext(projectId, query, limit);
        
        const formatted = memories.map((m: { finalScore: number; content: string }, i: number) => 
          `${i + 1}. [Relevance: ${m.finalScore.toFixed(2)}] ${m.content}`
        ).join('\n');
        
        return {
          success: true,
          output: `Found ${memories.length} relevant memories:\n\n${formatted}`,
        };
      },
    },

    // ============================================================
    // Requirement Management Tools
    // ============================================================
    {
      name: 'store_requirement',
      description: 'Store a project requirement in memory for future reference',
      inputSchema: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            description: 'Requirement category (e.g., "Functional", "Technical", "UI/UX", "Performance")',
          },
          requirement: {
            type: 'string',
            description: 'The requirement description',
          },
          importance: {
            type: 'number',
            description: 'Importance level 0-1 (default: 0.9 for requirements)',
            default: 0.9,
          },
        },
        required: ['category', 'requirement'],
      },
      execute: async (input: Record<string, unknown>) => {
        const category = input.category as string;
        const requirement = input.requirement as string;
        const importance = (input.importance as number) || 0.9;
        
        await projectMemoryService.storeRequirement(projectId, category, requirement, importance);
        
        return {
          success: true,
          output: `Stored requirement: [${category}] ${requirement}`,
        };
      },
    },

    {
      name: 'store_decision',
      description: 'Record a technical or design decision with rationale',
      inputSchema: {
        type: 'object',
        properties: {
          decision: {
            type: 'string',
            description: 'The decision made',
          },
          rationale: {
            type: 'string',
            description: 'Why this decision was made',
          },
          importance: {
            type: 'number',
            description: 'Importance level 0-1 (default: 0.85)',
            default: 0.85,
          },
        },
        required: ['decision', 'rationale'],
      },
      execute: async (input: Record<string, unknown>) => {
        const decision = input.decision as string;
        const rationale = input.rationale as string;
        const importance = (input.importance as number) || 0.85;
        
        await projectMemoryService.storeDecision(projectId, decision, rationale, importance);
        
        return {
          success: true,
          output: `Recorded decision: ${decision}`,
        };
      },
    },


    // ============================================================
    // Analysis Tools
    // ============================================================
    {
      name: 'analyze_requirements',
      description: 'Analyze all stored requirements to identify gaps, conflicts, or missing information',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      execute: async () => {
        const consolidated = await projectMemoryService.consolidateProjectKnowledge(projectId);
        
        const analysis = `
# Requirements Analysis

## Summary
- Total Requirements: ${consolidated.requirements.length}
- Decisions Made: ${consolidated.decisions.length}
- Constraints: ${consolidated.constraints.length}
- Features Identified: ${consolidated.features.length}

## Requirements
${consolidated.requirements.slice(0, 10).map((r: string, i: number) => `${i + 1}. ${r}`).join('\n')}
${consolidated.requirements.length > 10 ? `\n... and ${consolidated.requirements.length - 10} more` : ''}

## Key Decisions
${consolidated.decisions.slice(0, 5).map((d: string, i: number) => `${i + 1}. ${d}`).join('\n')}

## Constraints
${consolidated.constraints.map((c: string, i: number) => `${i + 1}. ${c}`).join('\n')}
`;
        
        return {
          success: true,
          output: analysis,
        };
      },
    },

    {
      name: 'get_comprehensive_context',
      description: 'Get comprehensive project context using multi-hop memory recall (use this when generating PRD)',
      inputSchema: {
        type: 'object',
        properties: {
          focus: {
            type: 'string',
            description: 'Optional focus area (e.g., "architecture", "features", "technical stack")',
          },
        },
      },
      execute: async (input: Record<string, unknown>) => {
        const focus = (input.focus as string) || 'project requirements goals features architecture';
        
        const comprehensive = await projectMemoryService.getComprehensiveKnowledge(
          projectId,
          focus,
          50,
        );
        
        const formatted = comprehensive.map((m: { finalScore: number; content: string }, i: number) => 
          `${i + 1}. [Score: ${m.finalScore.toFixed(2)}] ${m.content}`
        ).join('\n\n');
        
        return {
          success: true,
          output: `Comprehensive context (${comprehensive.length} memories):\n\n${formatted}`,
        };
      },
    },
  ];
}

/**
 * Get planning mode system prompt with tool restrictions
 */
export function getPlanningModeSystemPrompt(projectName: string): string {
  return `You are an AI planning agent helping to design and plan the software project: "${projectName}".

# Your Role - PLANNING MODE

You are in PLANNING MODE (not execution mode). Your goal is to:
1. Deeply understand the user's vision and requirements through conversation
2. Ask clarifying questions to fill gaps
3. Research technical approaches and best practices
4. Document requirements and decisions in memory
5. Generate a comprehensive PRD and task breakdown

# CRITICAL: Planning Mode Restrictions

You are in PLANNING MODE - you gather information and plan, but DO NOT implement anything.

**What you SHOULD do:**
- Search the web for documentation, best practices, and examples (webSearch, webDeepSearch)
- Store every requirement, decision, and constraint in memory (store_requirement, store_decision)
- Retrieve relevant project context (recall_project_context, search_memory)
- Analyze requirements for completeness (analyze_requirements)
- Research technical approaches and architectures
- Ask clarifying questions through conversation

**What you MUST NOT do:**
- Do NOT create, read, or edit any files
- Do NOT execute any code or shell commands  
- Do NOT generate images or videos
- Do NOT delegate tasks to other agents
- Do NOT create skills
- Do NOT modify user profiles or goals

# Important Guidelines

- **Use memory aggressively**: Store every requirement (importance: 0.9), every decision (0.85), every constraint (0.9)
- **Research thoroughly**: Use webDeepSearch for comprehensive technical research
- **Be specific**: Document concrete, actionable requirements
- **Think architecturally**: Consider tradeoffs, scalability, and best practices

# Available Tools

Planning-specific:
- recall_project_context: Retrieve stored requirements and decisions
- store_requirement: Store a requirement in memory (category + description)
- store_decision: Record a technical decision with rationale
- analyze_requirements: Analyze all stored requirements for gaps
- get_comprehensive_context: Deep multi-hop recall for comprehensive context

Memory:
- search_memory: Search all project memories
- store_memory: Store general information

Research:
- webSearch: Fast web search (tier 1)
- webDeepSearch: Comprehensive AI-powered search (tier 2)
- webGetPage: Fetch and read a web page

When you have sufficient information, use get_comprehensive_context to retrieve everything, then generate a comprehensive PRD and break it into tasks.`;
}
