import type { Tool } from './types.js';
import { ProjectMemoryService } from '@ai-engine/memory';

/**
 * Planning Mode Tools
 * 
 * Tools for gathering information, managing PRD, and creating tasks during project planning.
 * These tools DO NOT have access to file system, code execution, or build operations.
 */

/**
 * Generic DB client interface — just the subset of Prisma methods we need.
 * Using `any` for the client to avoid pulling in the full Prisma generated types.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PlanningDbClient = any;

/**
 * Create planning-specific tools (memory, analysis)
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
      description: 'Get comprehensive project context using multi-hop memory recall (use this before writing the PRD)',
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

// ============================================================
// PRD & Task Tools (database-backed)
// ============================================================

/**
 * Create tools for managing the PRD document (stored on the Project record).
 */
export function createPrdTools(db: PlanningDbClient, projectId: string): Tool[] {
  return [
    {
      name: 'save_prd',
      description:
        'Save or replace the full Product Requirements Document (PRD) for this project. ' +
        'The content should be comprehensive markdown covering project overview, goals, features, ' +
        'technical architecture, constraints, success metrics, etc. ' +
        'Call get_comprehensive_context first to gather all knowledge, then write the PRD.',
      inputSchema: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'The full PRD content in markdown format',
          },
        },
        required: ['content'],
      },
      execute: async (input: Record<string, unknown>) => {
        const content = input.content as string;
        if (!content || content.trim().length < 50) {
          return { success: false, output: 'PRD content is too short. Please provide a comprehensive document.' };
        }
        await db.project.update({
          where: { id: projectId },
          data: { prd: content },
        });
        return {
          success: true,
          output: `PRD saved successfully (${content.length} characters). The PRD panel on the right will update automatically.`,
        };
      },
    },

    {
      name: 'update_prd_section',
      description:
        'Update a specific section of the existing PRD. Use this to refine or expand parts of the PRD ' +
        'without rewriting the entire document. Provide the section heading to find and the new content for that section.',
      inputSchema: {
        type: 'object',
        properties: {
          sectionHeading: {
            type: 'string',
            description: 'The markdown heading of the section to update (e.g., "## Technical Architecture", "### Authentication")',
          },
          newContent: {
            type: 'string',
            description: 'The new content for this section (including the heading)',
          },
        },
        required: ['sectionHeading', 'newContent'],
      },
      execute: async (input: Record<string, unknown>) => {
        const sectionHeading = input.sectionHeading as string;
        const newContent = input.newContent as string;

        const project = await db.project.findUnique({ where: { id: projectId }, select: { prd: true } });
        const currentPrd = (project?.prd as string) || '';

        if (!currentPrd) {
          return { success: false, output: 'No PRD exists yet. Use save_prd to create the initial PRD first.' };
        }

        // Find the section by heading and replace it
        const headingLevel = (sectionHeading.match(/^#+/) || ['##'])[0];
        const escapedHeading = sectionHeading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Match from the heading to just before the next heading of equal or higher level
        const sectionRegex = new RegExp(
          `${escapedHeading}[\\s\\S]*?(?=\\n${headingLevel.replace(/#/g, '#?')} |$)`,
          'm',
        );

        let updatedPrd: string;
        if (sectionRegex.test(currentPrd)) {
          updatedPrd = currentPrd.replace(sectionRegex, newContent);
        } else {
          // Section not found — append at the end
          updatedPrd = currentPrd.trimEnd() + '\n\n' + newContent;
        }

        await db.project.update({
          where: { id: projectId },
          data: { prd: updatedPrd },
        });

        return {
          success: true,
          output: `Updated PRD section "${sectionHeading}" successfully.`,
        };
      },
    },

    {
      name: 'get_prd',
      description: 'Retrieve the current PRD document for this project. Use this to review what has been written so far before making updates.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      execute: async () => {
        const project = await db.project.findUnique({ where: { id: projectId }, select: { prd: true } });
        const prd = (project?.prd as string) || '';
        if (!prd) {
          return { success: true, output: 'No PRD has been created yet. Use save_prd to create one.' };
        }
        return {
          success: true,
          output: `Current PRD (${prd.length} characters):\n\n${prd}`,
        };
      },
    },
  ];
}

/**
 * Create tools for managing project tasks (stored as ProjectTask records).
 */
export function createTaskTools(db: PlanningDbClient, projectId: string): Tool[] {
  return [
    {
      name: 'add_task',
      description:
        'Add a new task to the project. Each task should be a concrete, actionable work item. ' +
        'Tasks can have dependencies on other tasks (by title). ' +
        'The task will appear in the dependency graph and task list panels.',
      inputSchema: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Short, descriptive task title (e.g., "Set up Next.js project", "Implement user authentication")',
          },
          description: {
            type: 'string',
            description: 'Detailed description of what this task involves',
          },
          taskType: {
            type: 'string',
            enum: ['feature', 'bugfix', 'test', 'qa', 'documentation'],
            description: 'Type of task (default: "feature")',
          },
          priority: {
            type: 'number',
            description: 'Priority 1-10, where 10 is highest (default: 5)',
          },
          dependencies: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of task titles this task depends on (must complete before this one starts)',
          },
        },
        required: ['title', 'description'],
      },
      execute: async (input: Record<string, unknown>) => {
        const title = input.title as string;
        const description = input.description as string;
        const taskType = (['feature', 'bugfix', 'test', 'qa', 'documentation'].includes(input.taskType as string)
          ? input.taskType as string
          : 'feature');
        const priority = typeof input.priority === 'number'
          ? Math.min(10, Math.max(1, input.priority))
          : 5;
        const dependencies = Array.isArray(input.dependencies) ? input.dependencies : [];

        // Check for duplicate title
        const existing = await db.projectTask.findFirst({
          where: { projectId, title },
        });
        if (existing) {
          return { success: false, output: `A task with title "${title}" already exists. Use update_task to modify it.` };
        }

        // Resolve dependency titles to IDs
        const depIds: string[] = [];
        if (dependencies.length > 0) {
          const depTasks = await db.projectTask.findMany({
            where: { projectId, title: { in: dependencies } },
            select: { id: true, title: true },
          });
          for (const d of depTasks) {
            depIds.push(d.id);
          }
          const foundTitles = depTasks.map((d: { title: string }) => d.title);
          const missing = dependencies.filter((t: string) => !foundTitles.includes(t));
          if (missing.length > 0) {
            // Still create the task but note missing deps
            console.warn(`[Planning] Dependencies not found for task "${title}": ${missing.join(', ')}`);
          }
        }

        const task = await db.projectTask.create({
          data: {
            projectId,
            title,
            description,
            taskType,
            priority,
            dependencies: depIds, // JSON array of task IDs
          },
        });

        return {
          success: true,
          output: `Task created: "${title}" (ID: ${task.id}, type: ${taskType}, priority: ${priority}${depIds.length > 0 ? `, depends on ${depIds.length} tasks` : ''})`,
        };
      },
    },

    {
      name: 'update_task',
      description: 'Update an existing project task by title. You can change its description, type, priority, or dependencies.',
      inputSchema: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Title of the task to update',
          },
          newTitle: {
            type: 'string',
            description: 'New title (optional — only if renaming)',
          },
          description: {
            type: 'string',
            description: 'Updated description',
          },
          taskType: {
            type: 'string',
            enum: ['feature', 'bugfix', 'test', 'qa', 'documentation'],
            description: 'Updated task type',
          },
          priority: {
            type: 'number',
            description: 'Updated priority 1-10',
          },
          dependencies: {
            type: 'array',
            items: { type: 'string' },
            description: 'Updated array of dependency task titles (replaces existing dependencies)',
          },
        },
        required: ['title'],
      },
      execute: async (input: Record<string, unknown>) => {
        const title = input.title as string;

        const task = await db.projectTask.findFirst({
          where: { projectId, title },
        });
        if (!task) {
          return { success: false, output: `Task "${title}" not found. Use list_tasks to see available tasks.` };
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updateData: Record<string, any> = {};
        if (input.newTitle) updateData.title = input.newTitle;
        if (input.description) updateData.description = input.description;
        if (input.taskType && ['feature', 'bugfix', 'test', 'qa', 'documentation'].includes(input.taskType as string)) {
          updateData.taskType = input.taskType;
        }
        if (typeof input.priority === 'number') {
          updateData.priority = Math.min(10, Math.max(1, input.priority));
        }
        if (Array.isArray(input.dependencies)) {
          const depTasks = await db.projectTask.findMany({
            where: { projectId, title: { in: input.dependencies } },
            select: { id: true },
          });
          updateData.dependencies = depTasks.map((d: { id: string }) => d.id);
        }

        if (Object.keys(updateData).length === 0) {
          return { success: false, output: 'No fields to update. Provide at least one field to change.' };
        }

        await db.projectTask.update({
          where: { id: task.id },
          data: updateData,
        });

        const fields = Object.keys(updateData).join(', ');
        return {
          success: true,
          output: `Task "${title}" updated (fields: ${fields}).`,
        };
      },
    },

    {
      name: 'remove_task',
      description: 'Remove a task from the project by title.',
      inputSchema: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Title of the task to remove',
          },
        },
        required: ['title'],
      },
      execute: async (input: Record<string, unknown>) => {
        const title = input.title as string;
        const task = await db.projectTask.findFirst({
          where: { projectId, title },
        });
        if (!task) {
          return { success: false, output: `Task "${title}" not found.` };
        }
        await db.projectTask.delete({ where: { id: task.id } });
        return {
          success: true,
          output: `Task "${title}" removed.`,
        };
      },
    },

    {
      name: 'list_tasks',
      description: 'List all tasks currently defined for this project, with their details and dependencies.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      execute: async () => {
        const tasks = await db.projectTask.findMany({
          where: { projectId },
          orderBy: { priority: 'desc' },
        });

        if (tasks.length === 0) {
          return { success: true, output: 'No tasks have been created yet. Use add_task to create tasks.' };
        }

        // Build a title→id map for resolving dep IDs back to titles
        const idToTitle = new Map(tasks.map((t: { id: string; title: string }) => [t.id, t.title]));

        const formatted = tasks.map((t: { title: string; description: string; taskType: string; priority: number; status: string; dependencies: unknown }, i: number) => {
          const deps = Array.isArray(t.dependencies)
            ? t.dependencies.map((depId: string) => idToTitle.get(depId) || depId).join(', ')
            : '';
          return `${i + 1}. [P${t.priority}] ${t.title} (${t.taskType}, ${t.status})${deps ? `\n   Dependencies: ${deps}` : ''}\n   ${t.description.substring(0, 150)}${t.description.length > 150 ? '...' : ''}`;
        }).join('\n\n');

        return {
          success: true,
          output: `Project has ${tasks.length} tasks:\n\n${formatted}`,
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
2. Ask clarifying questions (using ask_user with clickable options) to fill gaps
3. **PROACTIVELY RESEARCH** technical approaches, libraries, APIs, and best practices
4. Document requirements and decisions in memory
5. Write and maintain the PRD using save_prd / update_prd_section tools
6. Create and manage tasks using add_task / update_task / remove_task tools

# CRITICAL: Proactive Research (MOST IMPORTANT)

You MUST proactively research as the user describes their project. Do NOT just ask questions — research in parallel. Every time the user mentions a technology, feature, or approach:

1. **webSearch** (Tier 1) — Use FIRST for quick lookups: library docs, API references, GitHub repos, latest versions, compatibility info. This is fast and cheap — use it liberally.
2. **webDeepSearch** (Tier 2) — Use for complex topics: architecture comparisons, best practices synthesis, "how to build X" research, tradeoff analysis across multiple sources.
3. **webGetPage** — Read specific documentation pages, README files, or articles found via webSearch.
4. **NEVER use Tier 3** (DataForSEO) unless the user explicitly asks for SEO/keyword research.

**Research triggers (do this AUTOMATICALLY, without being asked):**
- User mentions "social network" → research social network architectures, real-time features, feed algorithms
- User mentions "AI-first" → research AI integration patterns, embedding APIs, recommendation systems
- User mentions a framework → research its latest version, ecosystem, known limitations
- User mentions "authentication" → research current auth best practices, OAuth providers, session management
- User describes any feature → research how similar products implement it, what libraries exist

**Research pattern for every user message:**
1. Read the user's message
2. Identify 1-3 topics that need research
3. Call webSearch/webDeepSearch for each topic (you can make multiple tool calls)
4. Store key findings as requirements/decisions in memory
5. THEN respond to the user with informed suggestions backed by your research

# PRD & Task Management (CRITICAL)

The PRD and task tree are **persistent database records** displayed in a live panel on the right side of the screen. The UI updates automatically every time you use these tools. **Nothing is final until the user clicks "Build Project"** — so be aggressive about creating and reshaping the plan.

## PRD Workflow
1. Start building the PRD early — even a rough draft after the first exchange is better than nothing.
2. Use **save_prd** to write the initial full PRD document (markdown format).
3. Use **update_prd_section** to refine specific sections as you learn more.
4. Use **get_prd** to review the current state before making changes.
5. The PRD should cover: Overview, Goals, Target Users, Features, Technical Architecture, Constraints, Success Metrics.
6. Keep refining the PRD as the conversation progresses — it's a living document.

## Task Tree Workflow (BUILD PROACTIVELY)

The task tree is a **living, mutable plan** — not a final contract. Build it aggressively from the start:

1. **Start adding tasks from the very first exchange.** Even if you only know "build a web app," create foundational tasks immediately: project setup, database schema, basic routing, etc. You can always refine or remove them later.
2. **Reshape the tree constantly.** Every time the user provides new information, update the task tree:
   - **Add** new tasks for newly discussed features
   - **Update** existing tasks with better descriptions, refined priorities, or corrected dependencies
   - **Remove** tasks that are no longer relevant (e.g., user changed direction)
   - **Reorganize dependencies** as the architecture becomes clearer
3. **Set proper dependencies** — if "Implement auth" depends on "Set up database", specify it. A good dependency graph is what makes the build phase efficient.
4. **Set proper priorities** — foundational tasks (project setup, DB, core data models) should be high priority (8-10); UI polish and nice-to-haves should be lower (3-5).
5. **Use list_tasks** before making changes to see the current state.
6. **Task types**: feature, bugfix, test, qa, documentation.
7. **Think in terms of build order**: The task tree defines the order agents will work in. Design it so independent tasks can run in parallel and dependent tasks are sequenced correctly.

**Example progression:**
- After 1st message ("I want to build a social app"): Create 5-8 foundational tasks (setup, DB, auth, core models, API skeleton, basic UI)
- After 2nd message ("It needs real-time chat"): Add chat tasks, update dependencies, maybe split "core models" into separate tasks
- After 3rd message ("Actually, let's use Firebase instead of Postgres"): Remove Postgres setup task, add Firebase setup, update all DB-dependent tasks
- Ongoing: Keep refining as every new detail emerges

# Planning Mode Restrictions

You gather information and plan, but DO NOT implement anything.

**What you SHOULD do:**
- Research proactively using webSearch (Tier 1) and webDeepSearch (Tier 2)
- Read documentation and articles with webGetPage
- Store every requirement, decision, and constraint in memory
- Write and maintain the PRD using save_prd / update_prd_section
- Create tasks using add_task, refine with update_task
- Ask structured questions using ask_user with clickable option buttons
- Analyze requirements for completeness

**What you MUST NOT do:**
- Do NOT create, read, or edit any files on disk
- Do NOT execute any code or shell commands
- Do NOT generate images or videos
- Do NOT delegate tasks to other agents

# Important Guidelines

- **Research first, respond second**: Always research before answering so your suggestions are informed and current
- **Use memory aggressively**: Store every requirement (importance: 0.9), every decision (0.85), every constraint (0.9)
- **Build the PRD early**: Start writing the PRD after the first exchange — even a rough draft is valuable
- **Build the task tree immediately**: Don't wait for clarity — create tasks now, reshape them later. The user sees the task tree update in real-time and it helps them think through the project.
- **Reshape constantly**: When the user changes direction, update/remove old tasks and add new ones. The tree is never "done" until the user clicks Build.
- **Be specific**: Document concrete, actionable requirements backed by research findings
- **Think architecturally**: Consider tradeoffs, scalability, and best practices based on what you find online
- **Cite your research**: When making recommendations, mention what you found

# Available Tools

Research (USE PROACTIVELY on every turn):
- webSearch: [Tier 1 — fast/cheap] Quick Google search. Use FIRST and OFTEN for any lookup.
- webSearchNews: [Tier 1 — fast/cheap] Search recent news and developments.
- webGetPage: [Tier 1 — fast/cheap] Read a specific web page by URL.
- webDeepSearch: [Tier 2 — comprehensive] AI-powered deep search with synthesis. Use for complex topics.
- webDeepSearchWithContext: [Tier 2 — comprehensive] Deep search with a specific research context.

PRD Management (persist to database — updates UI in real-time):
- save_prd: Save or replace the full PRD document (markdown)
- update_prd_section: Update a specific section of the PRD by heading
- get_prd: Retrieve the current PRD to review before editing

Task Management (persist to database — updates UI in real-time):
- add_task: Create a new task (title, description, type, priority, dependencies)
- update_task: Update an existing task's details
- remove_task: Remove a task
- list_tasks: List all current tasks with details

Planning Memory:
- recall_project_context: Retrieve stored requirements and decisions
- store_requirement: Store a requirement in memory (category + description)
- store_decision: Record a technical decision with rationale
- analyze_requirements: Analyze all stored requirements for gaps
- get_comprehensive_context: Deep multi-hop recall for comprehensive context

User Interaction:
- ask_user: Ask structured clarifying questions with clickable option buttons. Each question can have pre-defined options and/or allow free-text input.`;
}
