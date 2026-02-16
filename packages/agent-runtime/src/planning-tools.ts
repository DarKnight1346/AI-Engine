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
// Project Overview Tool (reads everything in one call)
// ============================================================

/**
 * Create the get_project_overview tool that returns the full project state
 * (PRD, all tasks with deps, all wireframes with composition) in one call.
 */
export function createProjectOverviewTools(db: PlanningDbClient, projectId: string): Tool[] {
  return [
    {
      name: 'get_project_overview',
      description:
        'Get a comprehensive snapshot of the ENTIRE current project state in a single call: ' +
        'the PRD document, ALL tasks (with descriptions, priorities, types, statuses, and dependency titles), ' +
        'and ALL wireframes (with element summaries, composition tree, and feature tags). ' +
        'Use this as your FIRST call when resuming a conversation on an existing project, or any time you need ' +
        'to understand the full picture before making changes. Much more efficient than calling list_tasks, ' +
        'get_prd, list_wireframes, and get_wireframe_tree separately.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      execute: async () => {
        // Fetch everything in parallel
        const [project, tasks, wireframes] = await Promise.all([
          db.project.findUnique({ where: { id: projectId }, select: { name: true, description: true, prd: true } }),
          db.projectTask.findMany({ where: { projectId }, orderBy: { priority: 'desc' } }),
          db.projectWireframe.findMany({ where: { projectId }, orderBy: { sortOrder: 'asc' } }),
        ]);

        const sections: string[] = [];

        // ── Project Info ──
        sections.push(`# Project: ${project?.name || '(unnamed)'}`);
        if (project?.description) {
          sections.push(`Description: ${project.description}`);
        }

        // ── PRD ──
        const prd = (project?.prd as string) || '';
        if (prd) {
          // Show a truncated summary if very long, full text if manageable
          const prdDisplay = prd.length > 8000
            ? prd.substring(0, 8000) + `\n\n... [PRD truncated — ${prd.length} total chars. Use get_prd for full text.]`
            : prd;
          sections.push(`\n# PRD (${prd.length} chars)\n\n${prdDisplay}`);
        } else {
          sections.push('\n# PRD\nNo PRD has been created yet.');
        }

        // ── Tasks ──
        if (tasks.length > 0) {
          const idToTitle = new Map(tasks.map((t: any) => [t.id, t.title]));

          const taskLines = tasks.map((t: any, i: number) => {
            const deps = Array.isArray(t.dependencies)
              ? t.dependencies.map((depId: string) => idToTitle.get(depId) || depId)
              : [];
            const depsStr = deps.length > 0 ? `\n     Depends on: ${deps.join(', ')}` : '';
            return `  ${i + 1}. [P${t.priority}] [${t.status}] "${t.title}" (${t.taskType})${depsStr}\n     ${t.description}`;
          });

          sections.push(`\n# Tasks (${tasks.length} total)\n\n${taskLines.join('\n\n')}`);

          // Summary stats
          const statusCounts: Record<string, number> = {};
          const typeCounts: Record<string, number> = {};
          for (const t of tasks) {
            const status = (t as any).status || 'pending';
            const type = (t as any).taskType || 'feature';
            statusCounts[status] = (statusCounts[status] || 0) + 1;
            typeCounts[type] = (typeCounts[type] || 0) + 1;
          }
          const rootTasks = tasks.filter((t: any) => !Array.isArray(t.dependencies) || t.dependencies.length === 0);

          sections.push(
            `\nTask Summary: ${tasks.length} total | ` +
            `${Object.entries(statusCounts).map(([s, c]) => `${c} ${s}`).join(', ')} | ` +
            `${Object.entries(typeCounts).map(([t, c]) => `${c} ${t}`).join(', ')} | ` +
            `${rootTasks.length} root tasks (no deps)`,
          );
        } else {
          sections.push('\n# Tasks\nNo tasks have been created yet.');
        }

        // ── Wireframes ──
        if (wireframes.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const idToName = new Map(wireframes.map((w: any) => [w.id, w.name]));

          // Build usage map
          const usedIn = new Map<string, string[]>();
          for (const wf of wireframes) {
            const elements = (Array.isArray((wf as any).elements) ? (wf as any).elements : []) as any[];
            for (const el of elements) {
              if (el.type === 'wireframeRef' && el.wireframeRefId) {
                if (!usedIn.has(el.wireframeRefId)) usedIn.set(el.wireframeRefId, []);
                usedIn.get(el.wireframeRefId)!.push((wf as any).name);
              }
            }
          }

          const wfLines = wireframes.map((wf: any, i: number) => {
            const elements = (Array.isArray(wf.elements) ? wf.elements : []) as any[];
            const tags = Array.isArray(wf.featureTags) ? wf.featureTags : [];
            const refs = (elements
              .filter((el: any) => el.type === 'wireframeRef' && el.wireframeRefId)
              .map((el: any) => idToName.get(el.wireframeRefId) || 'Unknown') as string[])
              .filter((name, idx, arr) => arr.indexOf(name) === idx);
            const primitives = elements.filter((el: any) => el.type !== 'wireframeRef');
            const primitiveTypes = [...new Set(primitives.map((e: any) => e.type))];

            const parts = [`  ${i + 1}. "${wf.name}" [${wf.wireframeType}] (${wf.canvasWidth}x${wf.canvasHeight})`];
            if (wf.description) parts.push(`     Description: ${wf.description}`);
            if (primitives.length > 0) parts.push(`     Elements: ${primitives.length} primitives (${primitiveTypes.join(', ')})`);
            if (refs.length > 0) parts.push(`     Contains: ${refs.join(', ')}`);
            const parents = usedIn.get(wf.id);
            if (parents && parents.length > 0) parts.push(`     Used in: ${parents.join(', ')}`);
            if (tags.length > 0) parts.push(`     Features: ${tags.join(', ')}`);
            return parts.join('\n');
          });

          sections.push(`\n# Wireframes (${wireframes.length} total)\n\n${wfLines.join('\n\n')}`);
        } else {
          sections.push('\n# Wireframes\nNo wireframes have been created yet.');
        }

        return {
          success: true,
          output: sections.join('\n'),
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
      name: 'batch_update_prd_sections',
      description:
        'Update multiple sections of the existing PRD in a single call. Use this instead of update_prd_section ' +
        'when you need to update more than one section. Each item has a sectionHeading and newContent.',
      inputSchema: {
        type: 'object',
        properties: {
          sections: {
            type: 'array',
            description: 'Array of section updates. Each has: sectionHeading, newContent.',
            items: {
              type: 'object',
              properties: {
                sectionHeading: {
                  type: 'string',
                  description: 'The markdown heading of the section to update (e.g., "## Technical Architecture")',
                },
                newContent: {
                  type: 'string',
                  description: 'The new content for this section (including the heading)',
                },
              },
              required: ['sectionHeading', 'newContent'],
            },
          },
        },
        required: ['sections'],
      },
      execute: async (input: Record<string, unknown>) => {
        const sections = input.sections as Array<Record<string, unknown>>;
        if (!Array.isArray(sections) || sections.length === 0) {
          return { success: false, output: 'sections array is required and must not be empty.' };
        }

        const project = await db.project.findUnique({ where: { id: projectId }, select: { prd: true } });
        let currentPrd = (project?.prd as string) || '';

        if (!currentPrd) {
          return { success: false, output: 'No PRD exists yet. Use save_prd to create the initial PRD first.' };
        }

        let updated = 0;
        let appended = 0;

        for (const s of sections) {
          const sectionHeading = s.sectionHeading as string;
          const newContent = s.newContent as string;

          const headingLevel = (sectionHeading.match(/^#+/) || ['##'])[0];
          const escapedHeading = sectionHeading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const sectionRegex = new RegExp(
            `${escapedHeading}[\\s\\S]*?(?=\\n${headingLevel.replace(/#/g, '#?')} |$)`,
            'm',
          );

          if (sectionRegex.test(currentPrd)) {
            currentPrd = currentPrd.replace(sectionRegex, newContent);
            updated++;
          } else {
            currentPrd = currentPrd.trimEnd() + '\n\n' + newContent;
            appended++;
          }
        }

        await db.project.update({
          where: { id: projectId },
          data: { prd: currentPrd },
        });

        return {
          success: true,
          output: `Batch PRD update complete: ${updated} sections updated in-place, ${appended} sections appended.`,
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
        'Add a new task to the project. Tasks MUST be highly granular — each one should be a single, ' +
        'atomic unit of work that an AI agent can complete in one focused session (roughly one file or one function). ' +
        'NEVER create broad tasks like "Implement user authentication" — instead break it into 5-10 specific tasks ' +
        'like "Create User model schema", "Add bcrypt password hashing util", "Create POST /auth/register endpoint", etc. ' +
        'Tasks can have dependencies on other tasks (by title). ' +
        'The task will appear in the dependency graph and task list panels.',
      inputSchema: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Short, precise task title scoped to a single unit of work (e.g., "Create User prisma schema", "Add POST /auth/login endpoint", "Create useAuth React hook")',
          },
          description: {
            type: 'string',
            description: 'Concise 1-2 sentence description of exactly what to build, which files to touch, and any key technical details. Written as a direct instruction to an AI coding agent. No fluff — just the actionable spec.',
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
      name: 'batch_add_tasks',
      description:
        'Add multiple tasks in a single call. Use this instead of add_task when creating more than one task. ' +
        'Each task in the array follows the same rules as add_task: highly granular, atomic, single unit of work. ' +
        'You can add hundreds of tasks in one call. Dependencies can reference tasks being created in the same batch by title.',
      inputSchema: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            description: 'Array of tasks to create. Each task has: title, description, taskType, priority, dependencies.',
            items: {
              type: 'object',
              properties: {
                title: {
                  type: 'string',
                  description: 'Short, precise task title scoped to a single unit of work',
                },
                description: {
                  type: 'string',
                  description: 'Concise 1-2 sentence description — a direct instruction to an AI coding agent',
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
                  description: 'Array of task titles this task depends on (can reference other tasks in this batch)',
                },
              },
              required: ['title', 'description'],
            },
          },
        },
        required: ['tasks'],
      },
      execute: async (input: Record<string, unknown>) => {
        const tasksInput = input.tasks as Array<Record<string, unknown>>;
        if (!Array.isArray(tasksInput) || tasksInput.length === 0) {
          return { success: false, output: 'tasks array is required and must not be empty.' };
        }

        const results: string[] = [];
        let created = 0;
        let skipped = 0;

        // First pass: create all tasks without dependencies to establish IDs
        const createdTaskIds = new Map<string, string>(); // title -> id

        for (const t of tasksInput) {
          const title = t.title as string;
          const description = t.description as string;
          const taskType = (['feature', 'bugfix', 'test', 'qa', 'documentation'].includes(t.taskType as string)
            ? t.taskType as string
            : 'feature');
          const priority = typeof t.priority === 'number'
            ? Math.min(10, Math.max(1, t.priority))
            : 5;

          // Check for duplicate title
          const existing = await db.projectTask.findFirst({
            where: { projectId, title },
          });
          if (existing) {
            skipped++;
            createdTaskIds.set(title, existing.id);
            results.push(`SKIPPED "${title}" (already exists)`);
            continue;
          }

          const task = await db.projectTask.create({
            data: {
              projectId,
              title,
              description,
              taskType,
              priority,
              dependencies: [], // will be resolved in second pass
            },
          });

          createdTaskIds.set(title, task.id);
          created++;
        }

        // Second pass: resolve and set dependencies
        let depsResolved = 0;
        for (const t of tasksInput) {
          const title = t.title as string;
          const dependencies = Array.isArray(t.dependencies) ? t.dependencies as string[] : [];
          if (dependencies.length === 0) continue;

          const taskId = createdTaskIds.get(title);
          if (!taskId) continue;

          // Resolve dependency titles to IDs (check batch-created tasks first, then DB)
          const depIds: string[] = [];
          const missing: string[] = [];
          for (const depTitle of dependencies) {
            const batchId = createdTaskIds.get(depTitle);
            if (batchId) {
              depIds.push(batchId);
            } else {
              // Look up in DB
              const depTask = await db.projectTask.findFirst({
                where: { projectId, title: depTitle },
                select: { id: true },
              });
              if (depTask) {
                depIds.push(depTask.id);
              } else {
                missing.push(depTitle);
              }
            }
          }

          if (depIds.length > 0) {
            await db.projectTask.update({
              where: { id: taskId },
              data: { dependencies: depIds },
            });
            depsResolved += depIds.length;
          }
          if (missing.length > 0) {
            results.push(`WARNING: deps not found for "${title}": ${missing.join(', ')}`);
          }
        }

        const summary = `Batch complete: ${created} tasks created, ${skipped} skipped (duplicate), ${depsResolved} dependencies resolved.`;
        if (results.length > 0) {
          return { success: true, output: `${summary}\n\nNotes:\n${results.join('\n')}` };
        }
        return { success: true, output: summary };
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
      name: 'batch_update_tasks',
      description:
        'Update multiple existing tasks in a single call. Use this instead of update_task when modifying more than one task. ' +
        'Each item identifies a task by title and provides the fields to update.',
      inputSchema: {
        type: 'object',
        properties: {
          updates: {
            type: 'array',
            description: 'Array of task updates. Each must include "title" to identify the task, plus any fields to change.',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Title of the task to update' },
                newTitle: { type: 'string', description: 'New title (optional — only if renaming)' },
                description: { type: 'string', description: 'Updated description' },
                taskType: {
                  type: 'string',
                  enum: ['feature', 'bugfix', 'test', 'qa', 'documentation'],
                  description: 'Updated task type',
                },
                priority: { type: 'number', description: 'Updated priority 1-10' },
                dependencies: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Updated array of dependency task titles (replaces existing)',
                },
              },
              required: ['title'],
            },
          },
        },
        required: ['updates'],
      },
      execute: async (input: Record<string, unknown>) => {
        const updates = input.updates as Array<Record<string, unknown>>;
        if (!Array.isArray(updates) || updates.length === 0) {
          return { success: false, output: 'updates array is required and must not be empty.' };
        }

        let updated = 0;
        let notFound = 0;
        const notes: string[] = [];

        for (const u of updates) {
          const title = u.title as string;
          const task = await db.projectTask.findFirst({ where: { projectId, title } });
          if (!task) {
            notFound++;
            notes.push(`NOT FOUND: "${title}"`);
            continue;
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const updateData: Record<string, any> = {};
          if (u.newTitle) updateData.title = u.newTitle;
          if (u.description) updateData.description = u.description;
          if (u.taskType && ['feature', 'bugfix', 'test', 'qa', 'documentation'].includes(u.taskType as string)) {
            updateData.taskType = u.taskType;
          }
          if (typeof u.priority === 'number') {
            updateData.priority = Math.min(10, Math.max(1, u.priority));
          }
          if (Array.isArray(u.dependencies)) {
            const depTasks = await db.projectTask.findMany({
              where: { projectId, title: { in: u.dependencies } },
              select: { id: true },
            });
            updateData.dependencies = depTasks.map((d: { id: string }) => d.id);
          }

          if (Object.keys(updateData).length > 0) {
            await db.projectTask.update({ where: { id: task.id }, data: updateData });
            updated++;
          }
        }

        const summary = `Batch update complete: ${updated} tasks updated, ${notFound} not found.`;
        return { success: true, output: notes.length > 0 ? `${summary}\n\n${notes.join('\n')}` : summary };
      },
    },

    {
      name: 'batch_remove_tasks',
      description:
        'Remove multiple tasks in a single call. Use this instead of remove_task when removing more than one task.',
      inputSchema: {
        type: 'object',
        properties: {
          titles: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of task titles to remove',
          },
        },
        required: ['titles'],
      },
      execute: async (input: Record<string, unknown>) => {
        const titles = input.titles as string[];
        if (!Array.isArray(titles) || titles.length === 0) {
          return { success: false, output: 'titles array is required and must not be empty.' };
        }

        let removed = 0;
        let notFound = 0;
        const notes: string[] = [];

        for (const title of titles) {
          const task = await db.projectTask.findFirst({ where: { projectId, title } });
          if (!task) {
            notFound++;
            notes.push(`NOT FOUND: "${title}"`);
            continue;
          }
          await db.projectTask.delete({ where: { id: task.id } });
          removed++;
        }

        const summary = `Batch remove complete: ${removed} tasks removed, ${notFound} not found.`;
        return { success: true, output: notes.length > 0 ? `${summary}\n\n${notes.join('\n')}` : summary };
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

// ============================================================
// Wireframe Tools (database-backed, composable)
// ============================================================

interface WireframeElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  wireframeRefId?: string;
  props?: Record<string, unknown>;
}

/**
 * Create tools for managing composable wireframes during planning.
 */
export function createWireframeTools(db: PlanningDbClient, projectId: string): Tool[] {
  return [
    {
      name: 'list_wireframes',
      description:
        'List all wireframes for this project with their names, types, feature tags, element counts, ' +
        'and composition relationships (which wireframes contain or are used by other wireframes). ' +
        'Use this to understand the full UI picture before writing the PRD or creating tasks.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      execute: async () => {
        const wireframes = await db.projectWireframe.findMany({
          where: { projectId },
          orderBy: { sortOrder: 'asc' },
        });

        if (wireframes.length === 0) {
          return { success: true, output: 'No wireframes have been created yet. Use suggest_wireframe to create wireframes based on the conversation.' };
        }

        const idToName = new Map(wireframes.map((w: any) => [w.id, w.name]));

        const formatted = wireframes.map((wf: any, i: number) => {
          const elements = (Array.isArray(wf.elements) ? wf.elements : []) as WireframeElement[];
          const tags = Array.isArray(wf.featureTags) ? wf.featureTags : [];
          const refs = elements
            .filter((el) => el.type === 'wireframeRef' && el.wireframeRefId)
            .map((el) => idToName.get(el.wireframeRefId!) || 'Unknown')
            .filter((name, idx, arr) => arr.indexOf(name) === idx);
          const primitives = elements.filter((el) => el.type !== 'wireframeRef');

          const containsStr = refs.length > 0 ? `\n   Contains: ${refs.join(', ')}` : '';
          const tagsStr = tags.length > 0 ? `\n   Features: ${tags.join(', ')}` : '';
          const elemSummary = primitives.length > 0
            ? `\n   Elements: ${primitives.length} primitives (${[...new Set(primitives.map((e) => e.type))].join(', ')})`
            : '';

          return `${i + 1}. "${wf.name}" [${wf.wireframeType}] (${wf.canvasWidth}x${wf.canvasHeight})${elemSummary}${containsStr}${tagsStr}`;
        }).join('\n\n');

        // Compute usage
        const usedIn = new Map<string, string[]>();
        for (const wf of wireframes) {
          const elements = (Array.isArray(wf.elements) ? wf.elements : []) as WireframeElement[];
          for (const el of elements) {
            if (el.type === 'wireframeRef' && el.wireframeRefId) {
              if (!usedIn.has(el.wireframeRefId)) usedIn.set(el.wireframeRefId, []);
              usedIn.get(el.wireframeRefId)!.push(wf.name);
            }
          }
        }

        const usageInfo = Array.from(usedIn.entries())
          .map(([id, parents]) => `"${idToName.get(id) || id}" is used in: ${parents.join(', ')}`)
          .join('\n');

        return {
          success: true,
          output: `Project has ${wireframes.length} wireframes:\n\n${formatted}${usageInfo ? `\n\nComposition usage:\n${usageInfo}` : ''}`,
        };
      },
    },

    {
      name: 'get_wireframe_details',
      description:
        'Get full details of a specific wireframe by name, including all elements with positions and sizes. ' +
        'For wireframeRef elements, also shows what wireframe they reference. ' +
        'Use this when writing detailed PRD sections about specific pages or components.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The name of the wireframe to inspect' },
        },
        required: ['name'],
      },
      execute: async (input: Record<string, unknown>) => {
        const name = input.name as string;
        const wf = await db.projectWireframe.findFirst({
          where: { projectId, name },
        });

        if (!wf) {
          return { success: false, output: `Wireframe "${name}" not found. Use list_wireframes to see available wireframes.` };
        }

        const elements = (Array.isArray(wf.elements) ? wf.elements : []) as WireframeElement[];
        const tags = Array.isArray(wf.featureTags) ? wf.featureTags : [];

        // Resolve ref names
        const refIds = elements.filter((el) => el.type === 'wireframeRef' && el.wireframeRefId).map((el) => el.wireframeRefId!);
        const refWfs = refIds.length > 0
          ? await db.projectWireframe.findMany({ where: { id: { in: refIds } }, select: { id: true, name: true } })
          : [];
        const refIdToName = new Map(refWfs.map((r: any) => [r.id, r.name]));

        const elemDetails = elements.map((el, i) => {
          const base = `  ${i + 1}. [${el.type}] "${el.label}" at (${el.x}, ${el.y}) size ${el.width}x${el.height}`;
          if (el.type === 'wireframeRef' && el.wireframeRefId) {
            return `${base} → references "${refIdToName.get(el.wireframeRefId) || 'Unknown'}"`;
          }
          return base;
        }).join('\n');

        return {
          success: true,
          output: `Wireframe: "${wf.name}" [${wf.wireframeType}]\nCanvas: ${wf.canvasWidth}x${wf.canvasHeight}\nDescription: ${wf.description || '(none)'}\nFeature Tags: ${tags.length > 0 ? tags.join(', ') : '(none)'}\n\nElements (${elements.length}):\n${elemDetails || '  (empty)'}`,
        };
      },
    },

    {
      name: 'get_wireframe_tree',
      description:
        'Get the full composition tree showing which pages contain which components, and which components ' +
        'contain sub-components. This maps directly to the UI component hierarchy and helps structure tasks correctly. ' +
        'Use before creating tasks to ensure the dependency graph mirrors the wireframe composition.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      execute: async () => {
        const wireframes = await db.projectWireframe.findMany({
          where: { projectId },
          orderBy: { sortOrder: 'asc' },
        });

        if (wireframes.length === 0) {
          return { success: true, output: 'No wireframes exist yet.' };
        }

        const idToName = new Map(wireframes.map((w: any) => [w.id, w.name]));
        const idToType = new Map(wireframes.map((w: any) => [w.id, w.wireframeType]));

        // Build adjacency: parent -> children
        const children = new Map<string, string[]>();
        const hasParent = new Set<string>();

        for (const wf of wireframes) {
          const elements = (Array.isArray(wf.elements) ? wf.elements : []) as WireframeElement[];
          const refs = [...new Set(
            elements
              .filter((el) => el.type === 'wireframeRef' && el.wireframeRefId)
              .map((el) => el.wireframeRefId!),
          )];
          if (refs.length > 0) {
            children.set(wf.id, refs);
            refs.forEach((r) => hasParent.add(r));
          }
        }

        // Find roots (no parent)
        const roots = wireframes.filter((wf: any) => !hasParent.has(wf.id));

        // Recursive tree builder
        const printTree = (id: string, depth: number, visited: Set<string>): string => {
          if (visited.has(id)) return `${'  '.repeat(depth)}[circular: ${idToName.get(id)}]`;
          visited.add(id);
          const name = idToName.get(id) || id;
          const type = idToType.get(id) || 'unknown';
          const line = `${'  '.repeat(depth)}${depth > 0 ? '├─ ' : ''}${name} [${type}]`;
          const kids = children.get(id) || [];
          const kidLines = kids.map((kid) => printTree(kid, depth + 1, new Set(visited)));
          return [line, ...kidLines].join('\n');
        };

        const tree = roots.map((r: any) => printTree(r.id, 0, new Set())).join('\n\n');

        // Orphans (components not used anywhere and not containing anything)
        const orphans = wireframes.filter((wf: any) =>
          !hasParent.has(wf.id) && !(children.get(wf.id)?.length),
        );

        return {
          success: true,
          output: `Wireframe Composition Tree:\n\n${tree}${orphans.length > 0 ? `\n\nStandalone wireframes: ${orphans.map((o: any) => `"${o.name}" [${o.wireframeType}]`).join(', ')}` : ''}`,
        };
      },
    },

    {
      name: 'suggest_wireframe',
      description:
        'Create a wireframe with positioned elements based on the conversation context. ' +
        'The wireframe appears immediately in the Wireframes gallery where the user can refine it visually. ' +
        'Use this proactively when the user describes UI features — e.g., "users can create posts" → ' +
        'create a "Post Box" component wireframe with textarea, submit button, image upload. ' +
        'For pages, include wireframeRef elements pointing at existing component wireframes by ID. ' +
        'To get component IDs for nesting, call list_wireframes first.',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Wireframe name (e.g., "Post Box", "Profile Page", "Login Modal")',
          },
          wireframeType: {
            type: 'string',
            enum: ['page', 'component', 'modal', 'section'],
            description: 'Type of wireframe. Use "component" for reusable pieces, "page" for full pages.',
          },
          description: {
            type: 'string',
            description: 'Brief description of the wireframe purpose',
          },
          elements: {
            type: 'array',
            description: 'Array of positioned elements. Each has: type (button|textInput|textarea|text|heading|image|card|navbar|sidebar|list|container|wireframeRef|etc.), x, y, width, height, label, and optionally wireframeRefId for nested wireframes.',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string' },
                x: { type: 'number' },
                y: { type: 'number' },
                width: { type: 'number' },
                height: { type: 'number' },
                label: { type: 'string' },
                wireframeRefId: { type: 'string', description: 'ID of another wireframe to embed (for type=wireframeRef only)' },
              },
              required: ['type', 'x', 'y', 'width', 'height', 'label'],
            },
          },
          featureTags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Feature tags for this wireframe (e.g., ["user-posts", "content-creation"])',
          },
          canvasWidth: { type: 'number', description: 'Canvas width in pixels (default: 800)' },
          canvasHeight: { type: 'number', description: 'Canvas height in pixels (default: 600)' },
        },
        required: ['name', 'wireframeType', 'elements'],
      },
      execute: async (input: Record<string, unknown>) => {
        const name = input.name as string;
        const wireframeType = input.wireframeType as string || 'component';
        const description = (input.description as string) || null;
        const rawElements = input.elements as Array<Record<string, unknown>> || [];
        const featureTags = Array.isArray(input.featureTags) ? input.featureTags : [];
        const canvasWidth = (input.canvasWidth as number) || 800;
        const canvasHeight = (input.canvasHeight as number) || 600;

        // Check name uniqueness
        const existing = await db.projectWireframe.findFirst({
          where: { projectId, name },
        });
        if (existing) {
          return { success: false, output: `A wireframe named "${name}" already exists. Use a different name or call list_wireframes to see existing wireframes.` };
        }

        // Build elements with IDs
        const elements: WireframeElement[] = rawElements.map((el, i) => ({
          id: `el_${Date.now()}_${i}`,
          type: (el.type as string) || 'container',
          x: (el.x as number) || 0,
          y: (el.y as number) || 0,
          width: (el.width as number) || 100,
          height: (el.height as number) || 50,
          label: (el.label as string) || '',
          wireframeRefId: el.wireframeRefId as string | undefined,
        }));

        // Get next sort order
        const maxSort = await db.projectWireframe.findFirst({
          where: { projectId },
          orderBy: { sortOrder: 'desc' },
          select: { sortOrder: true },
        });

        const wf = await db.projectWireframe.create({
          data: {
            projectId,
            name,
            description,
            wireframeType,
            elements,
            featureTags,
            canvasWidth,
            canvasHeight,
            sortOrder: (maxSort?.sortOrder ?? -1) + 1,
          },
        });

        return {
          success: true,
          output: `Wireframe "${name}" created (ID: ${wf.id}, type: ${wireframeType}, ${elements.length} elements). ` +
            `It now appears in the Wireframes tab. The user can edit it visually in the wireframe editor.` +
            (featureTags.length > 0 ? ` Feature tags: ${featureTags.join(', ')}` : ''),
        };
      },
    },

    {
      name: 'batch_suggest_wireframes',
      description:
        'Create multiple wireframes in a single call. Use this instead of suggest_wireframe when creating more than one wireframe. ' +
        'Each wireframe in the array follows the same rules as suggest_wireframe. ' +
        'Wireframes created in the same batch can reference each other: earlier wireframes in the array ' +
        'are created first and their IDs are available for wireframeRef elements in later wireframes. ' +
        'Use the "refName" field on wireframeRef elements to reference a wireframe by name from this batch.',
      inputSchema: {
        type: 'object',
        properties: {
          wireframes: {
            type: 'array',
            description: 'Array of wireframes to create. Each has: name, wireframeType, elements, description, featureTags, canvasWidth, canvasHeight.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Wireframe name' },
                wireframeType: {
                  type: 'string',
                  enum: ['page', 'component', 'modal', 'section'],
                  description: 'Type of wireframe',
                },
                description: { type: 'string', description: 'Brief description' },
                elements: {
                  type: 'array',
                  description: 'Array of positioned elements',
                  items: {
                    type: 'object',
                    properties: {
                      type: { type: 'string' },
                      x: { type: 'number' },
                      y: { type: 'number' },
                      width: { type: 'number' },
                      height: { type: 'number' },
                      label: { type: 'string' },
                      wireframeRefId: { type: 'string', description: 'ID of another wireframe to embed' },
                      refName: { type: 'string', description: 'Name of a wireframe from this batch to embed (resolved to ID automatically)' },
                    },
                    required: ['type', 'x', 'y', 'width', 'height', 'label'],
                  },
                },
                featureTags: { type: 'array', items: { type: 'string' }, description: 'Feature tags' },
                canvasWidth: { type: 'number', description: 'Canvas width (default: 800)' },
                canvasHeight: { type: 'number', description: 'Canvas height (default: 600)' },
              },
              required: ['name', 'wireframeType', 'elements'],
            },
          },
        },
        required: ['wireframes'],
      },
      execute: async (input: Record<string, unknown>) => {
        const wireframesInput = input.wireframes as Array<Record<string, unknown>>;
        if (!Array.isArray(wireframesInput) || wireframesInput.length === 0) {
          return { success: false, output: 'wireframes array is required and must not be empty.' };
        }

        const results: string[] = [];
        let created = 0;
        let skipped = 0;
        const createdNameToId = new Map<string, string>(); // for cross-batch references

        // Get starting sort order
        const maxSort = await db.projectWireframe.findFirst({
          where: { projectId },
          orderBy: { sortOrder: 'desc' },
          select: { sortOrder: true },
        });
        let nextSort = (maxSort?.sortOrder ?? -1) + 1;

        for (const wfInput of wireframesInput) {
          const name = wfInput.name as string;
          const wireframeType = (wfInput.wireframeType as string) || 'component';
          const description = (wfInput.description as string) || null;
          const rawElements = (wfInput.elements as Array<Record<string, unknown>>) || [];
          const featureTags = Array.isArray(wfInput.featureTags) ? wfInput.featureTags : [];
          const canvasWidth = (wfInput.canvasWidth as number) || 800;
          const canvasHeight = (wfInput.canvasHeight as number) || 600;

          // Check name uniqueness
          const existing = await db.projectWireframe.findFirst({ where: { projectId, name } });
          if (existing) {
            skipped++;
            createdNameToId.set(name, existing.id);
            results.push(`SKIPPED "${name}" (already exists, ID: ${existing.id})`);
            continue;
          }

          // Build elements, resolving refName references
          const elements: WireframeElement[] = rawElements.map((el, i) => {
            let wireframeRefId = el.wireframeRefId as string | undefined;
            // Resolve refName to ID from this batch
            if (!wireframeRefId && el.refName) {
              wireframeRefId = createdNameToId.get(el.refName as string);
            }
            return {
              id: `el_${Date.now()}_${created}_${i}`,
              type: (el.type as string) || 'container',
              x: (el.x as number) || 0,
              y: (el.y as number) || 0,
              width: (el.width as number) || 100,
              height: (el.height as number) || 50,
              label: (el.label as string) || '',
              wireframeRefId,
            };
          });

          const wf = await db.projectWireframe.create({
            data: {
              projectId,
              name,
              description,
              wireframeType,
              elements,
              featureTags,
              canvasWidth,
              canvasHeight,
              sortOrder: nextSort++,
            },
          });

          createdNameToId.set(name, wf.id);
          created++;
          results.push(`CREATED "${name}" (ID: ${wf.id}, type: ${wireframeType}, ${elements.length} elements)`);
        }

        const summary = `Batch wireframe complete: ${created} wireframes created, ${skipped} skipped (duplicate).`;
        return { success: true, output: `${summary}\n\n${results.join('\n')}` };
      },
    },

    {
      name: 'update_wireframe',
      description:
        'Update an existing wireframe by name. You can change its elements (replace the full array), ' +
        'description, wireframeType, featureTags, canvasWidth, canvasHeight, or rename it. ' +
        'Use get_wireframe_details first to see the current state, then provide the updated fields. ' +
        'To add/remove/move elements, provide the full new elements array (it replaces the existing one).',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Current name of the wireframe to update',
          },
          newName: {
            type: 'string',
            description: 'New name for the wireframe (optional — only if renaming)',
          },
          wireframeType: {
            type: 'string',
            enum: ['page', 'component', 'modal', 'section'],
            description: 'Updated wireframe type',
          },
          description: {
            type: 'string',
            description: 'Updated description',
          },
          elements: {
            type: 'array',
            description: 'Full replacement array of elements. Replaces ALL existing elements.',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string' },
                x: { type: 'number' },
                y: { type: 'number' },
                width: { type: 'number' },
                height: { type: 'number' },
                label: { type: 'string' },
                wireframeRefId: { type: 'string', description: 'ID of another wireframe to embed (for type=wireframeRef only)' },
                refName: { type: 'string', description: 'Name of an existing wireframe to embed (resolved to ID automatically)' },
              },
              required: ['type', 'x', 'y', 'width', 'height', 'label'],
            },
          },
          featureTags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Updated feature tags (replaces existing)',
          },
          canvasWidth: { type: 'number', description: 'Updated canvas width' },
          canvasHeight: { type: 'number', description: 'Updated canvas height' },
        },
        required: ['name'],
      },
      execute: async (input: Record<string, unknown>) => {
        const name = input.name as string;
        const wf = await db.projectWireframe.findFirst({ where: { projectId, name } });
        if (!wf) {
          return { success: false, output: `Wireframe "${name}" not found. Use list_wireframes to see available wireframes.` };
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updateData: Record<string, any> = {};

        if (input.newName && input.newName !== name) {
          const nameConflict = await db.projectWireframe.findFirst({ where: { projectId, name: input.newName as string } });
          if (nameConflict) {
            return { success: false, output: `A wireframe named "${input.newName}" already exists. Choose a different name.` };
          }
          updateData.name = input.newName;
        }
        if (input.wireframeType && ['page', 'component', 'modal', 'section'].includes(input.wireframeType as string)) {
          updateData.wireframeType = input.wireframeType;
        }
        if (typeof input.description === 'string') {
          updateData.description = input.description;
        }
        if (Array.isArray(input.featureTags)) {
          updateData.featureTags = input.featureTags;
        }
        if (typeof input.canvasWidth === 'number') {
          updateData.canvasWidth = input.canvasWidth;
        }
        if (typeof input.canvasHeight === 'number') {
          updateData.canvasHeight = input.canvasHeight;
        }

        if (Array.isArray(input.elements)) {
          const rawElements = input.elements as Array<Record<string, unknown>>;
          // Resolve refName → wireframeRefId for any wireframeRef elements
          const elements: WireframeElement[] = [];
          for (let i = 0; i < rawElements.length; i++) {
            const el = rawElements[i];
            let wireframeRefId = el.wireframeRefId as string | undefined;
            if (!wireframeRefId && el.refName) {
              const refWf = await db.projectWireframe.findFirst({
                where: { projectId, name: el.refName as string },
                select: { id: true },
              });
              if (refWf) wireframeRefId = refWf.id;
            }
            elements.push({
              id: `el_${Date.now()}_${i}`,
              type: (el.type as string) || 'container',
              x: (el.x as number) || 0,
              y: (el.y as number) || 0,
              width: (el.width as number) || 100,
              height: (el.height as number) || 50,
              label: (el.label as string) || '',
              wireframeRefId,
            });
          }
          updateData.elements = elements;
        }

        if (Object.keys(updateData).length === 0) {
          return { success: false, output: 'No fields to update. Provide at least one field to change.' };
        }

        await db.projectWireframe.update({ where: { id: wf.id }, data: updateData });

        const fields = Object.keys(updateData).join(', ');
        return {
          success: true,
          output: `Wireframe "${name}" updated (fields: ${fields}).`,
        };
      },
    },

    {
      name: 'batch_update_wireframes',
      description:
        'Update multiple existing wireframes in a single call. Use this instead of update_wireframe when ' +
        'modifying more than one wireframe. Each item identifies a wireframe by name and provides fields to update.',
      inputSchema: {
        type: 'object',
        properties: {
          updates: {
            type: 'array',
            description: 'Array of wireframe updates. Each must include "name" to identify the wireframe.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Current name of the wireframe to update' },
                newName: { type: 'string', description: 'New name (optional — only if renaming)' },
                wireframeType: {
                  type: 'string',
                  enum: ['page', 'component', 'modal', 'section'],
                  description: 'Updated wireframe type',
                },
                description: { type: 'string', description: 'Updated description' },
                elements: {
                  type: 'array',
                  description: 'Full replacement array of elements',
                  items: {
                    type: 'object',
                    properties: {
                      type: { type: 'string' },
                      x: { type: 'number' },
                      y: { type: 'number' },
                      width: { type: 'number' },
                      height: { type: 'number' },
                      label: { type: 'string' },
                      wireframeRefId: { type: 'string' },
                      refName: { type: 'string', description: 'Name of an existing wireframe to embed (resolved to ID)' },
                    },
                    required: ['type', 'x', 'y', 'width', 'height', 'label'],
                  },
                },
                featureTags: { type: 'array', items: { type: 'string' }, description: 'Updated feature tags' },
                canvasWidth: { type: 'number' },
                canvasHeight: { type: 'number' },
              },
              required: ['name'],
            },
          },
        },
        required: ['updates'],
      },
      execute: async (input: Record<string, unknown>) => {
        const updates = input.updates as Array<Record<string, unknown>>;
        if (!Array.isArray(updates) || updates.length === 0) {
          return { success: false, output: 'updates array is required and must not be empty.' };
        }

        let updated = 0;
        let notFound = 0;
        const notes: string[] = [];

        for (const u of updates) {
          const name = u.name as string;
          const wf = await db.projectWireframe.findFirst({ where: { projectId, name } });
          if (!wf) {
            notFound++;
            notes.push(`NOT FOUND: "${name}"`);
            continue;
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const updateData: Record<string, any> = {};

          if (u.newName && u.newName !== name) {
            const nameConflict = await db.projectWireframe.findFirst({ where: { projectId, name: u.newName as string } });
            if (nameConflict) {
              notes.push(`SKIPPED "${name}": name "${u.newName}" already taken`);
              continue;
            }
            updateData.name = u.newName;
          }
          if (u.wireframeType && ['page', 'component', 'modal', 'section'].includes(u.wireframeType as string)) {
            updateData.wireframeType = u.wireframeType;
          }
          if (typeof u.description === 'string') {
            updateData.description = u.description;
          }
          if (Array.isArray(u.featureTags)) {
            updateData.featureTags = u.featureTags;
          }
          if (typeof u.canvasWidth === 'number') {
            updateData.canvasWidth = u.canvasWidth;
          }
          if (typeof u.canvasHeight === 'number') {
            updateData.canvasHeight = u.canvasHeight;
          }

          if (Array.isArray(u.elements)) {
            const rawElements = u.elements as Array<Record<string, unknown>>;
            const elements: WireframeElement[] = [];
            for (let i = 0; i < rawElements.length; i++) {
              const el = rawElements[i];
              let wireframeRefId = el.wireframeRefId as string | undefined;
              if (!wireframeRefId && el.refName) {
                const refWf = await db.projectWireframe.findFirst({
                  where: { projectId, name: el.refName as string },
                  select: { id: true },
                });
                if (refWf) wireframeRefId = refWf.id;
              }
              elements.push({
                id: `el_${Date.now()}_${i}`,
                type: (el.type as string) || 'container',
                x: (el.x as number) || 0,
                y: (el.y as number) || 0,
                width: (el.width as number) || 100,
                height: (el.height as number) || 50,
                label: (el.label as string) || '',
                wireframeRefId,
              });
            }
            updateData.elements = elements;
          }

          if (Object.keys(updateData).length > 0) {
            await db.projectWireframe.update({ where: { id: wf.id }, data: updateData });
            updated++;
          }
        }

        const summary = `Batch wireframe update complete: ${updated} wireframes updated, ${notFound} not found.`;
        return { success: true, output: notes.length > 0 ? `${summary}\n\n${notes.join('\n')}` : summary };
      },
    },

    {
      name: 'delete_wireframe',
      description:
        'Delete a wireframe by name. If other wireframes reference it (via wireframeRef), those references ' +
        'will become broken — use list_wireframes first to check composition usage.',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the wireframe to delete',
          },
        },
        required: ['name'],
      },
      execute: async (input: Record<string, unknown>) => {
        const name = input.name as string;
        const wf = await db.projectWireframe.findFirst({ where: { projectId, name } });
        if (!wf) {
          return { success: false, output: `Wireframe "${name}" not found.` };
        }
        await db.projectWireframe.delete({ where: { id: wf.id } });
        return {
          success: true,
          output: `Wireframe "${name}" deleted.`,
        };
      },
    },

    {
      name: 'batch_delete_wireframes',
      description:
        'Delete multiple wireframes in a single call. Use this instead of delete_wireframe when removing more than one.',
      inputSchema: {
        type: 'object',
        properties: {
          names: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of wireframe names to delete',
          },
        },
        required: ['names'],
      },
      execute: async (input: Record<string, unknown>) => {
        const names = input.names as string[];
        if (!Array.isArray(names) || names.length === 0) {
          return { success: false, output: 'names array is required and must not be empty.' };
        }

        let deleted = 0;
        let notFound = 0;
        const notes: string[] = [];

        for (const name of names) {
          const wf = await db.projectWireframe.findFirst({ where: { projectId, name } });
          if (!wf) {
            notFound++;
            notes.push(`NOT FOUND: "${name}"`);
            continue;
          }
          await db.projectWireframe.delete({ where: { id: wf.id } });
          deleted++;
        }

        const summary = `Batch wireframe delete complete: ${deleted} deleted, ${notFound} not found.`;
        return { success: true, output: notes.length > 0 ? `${summary}\n\n${notes.join('\n')}` : summary };
      },
    },
  ];
}

/**
 * Get planning mode system prompt with tool restrictions
 */
export function getPlanningModeSystemPrompt(projectName: string): string {
  return `You are an expert software architect and product strategist planning the project: "${projectName}".

# Your Role

You are a proactive technical partner. You don't just take requirements — you deeply understand what the user is trying to achieve, research the landscape, and bring solutions, patterns, libraries, and architectural insights the user may not know about. You think ahead, anticipate needs, and build a comprehensive plan that an AI agent swarm can execute.

**How you operate:**
- When the user describes what they want, you research it, understand the problem space, and come back with informed, opinionated recommendations — not just questions.
- You proactively suggest technologies, libraries, architecture patterns, and approaches. If the user says "I want auth", you don't just ask "what kind?" — you research current best practices and propose a specific approach with rationale.
- You search the web to stay current. Use webSearch for quick lookups (docs, repos, versions). Use webDeepSearch for deeper analysis (architecture comparisons, "how to build X" synthesis). Use webGetPage to read specific docs or articles.
- You create wireframes, build the PRD, and break everything into granular tasks — all proactively, reshaping as the conversation evolves.
- You store requirements and decisions in memory so nothing is lost.
- **Before making changes, fetch the current state.** Use get_project_overview, list_tasks, get_prd, or list_wireframes to understand what already exists. Don't recreate things — update them.

# PRD & Task Management

The PRD and task tree are **persistent database records** displayed in a live panel on the right side of the screen. The UI updates automatically every time you use these tools. **Nothing is final until the user clicks "Build Project"** — so be aggressive about creating and reshaping the plan.

## PRD Workflow
1. Start building the PRD early — even a rough draft after the first exchange is better than nothing.
2. Use **save_prd** to write the initial full PRD document (markdown format).
3. Use **update_prd_section** to refine specific sections as you learn more.
4. Use **get_prd** to review the current state before making changes.
5. The PRD should cover: Overview, Goals, Target Users, Features, Technical Architecture, Constraints, Success Metrics.
6. Keep refining the PRD as the conversation progresses — it's a living document.

## Task Tree Workflow (BUILD PROACTIVELY — EXTREME GRANULARITY)

The task tree is a **living, mutable plan** — not a final contract. Build it aggressively from the start. **These tasks will be handed off to AI coding agents**, so they must be extremely granular and have concise, direct descriptions.

### CRITICAL: Use Batch Tools

**ALWAYS use batch tools when creating or modifying more than one item.** This is essential for efficiency:
- **batch_add_tasks** — Add ALL tasks in a SINGLE call. You can add 50, 100, even 200 tasks in one call. NEVER use add_task in a loop.
- **batch_update_tasks** — Update many tasks in one call. NEVER use update_task in a loop.
- **batch_remove_tasks** — Remove many tasks in one call. NEVER use remove_task in a loop.
- **batch_suggest_wireframes** — Create ALL wireframes in one call. NEVER use suggest_wireframe in a loop.
- **batch_update_prd_sections** — Update many PRD sections in one call.

Example: If you need to add 30 tasks, make ONE call to batch_add_tasks with all 30 tasks in the array. Do NOT make 30 separate add_task calls.

### Granularity Rules (CRITICAL)

**Each task = one atomic unit of work.** Think "one file", "one function", "one endpoint", "one component", "one schema". If a task touches more than 2-3 files, it's too broad — split it.

**BAD (too broad):**
- "Implement user authentication" — this is 8+ tasks
- "Build dashboard UI" — this is 10+ tasks
- "Set up database" — this is 3+ tasks

**GOOD (atomic):**
- "Create User and Session prisma models"
- "Add bcrypt hashPassword and verifyPassword utils"
- "Create POST /api/auth/register endpoint"
- "Create POST /api/auth/login endpoint with JWT"
- "Create auth middleware for protected routes"
- "Create useAuth React hook"
- "Create LoginForm component"
- "Create RegisterForm component"
- "Add auth route guards to app layout"

### Description Rules (CRITICAL)

Descriptions are **direct instructions to an AI coding agent**. Keep them concise (1-2 sentences max). No background, no fluff — just what to build and key technical details.

**BAD:** "This task involves implementing the user authentication system. The developer should create login and registration functionality using industry best practices for security. Consider using bcrypt for password hashing and JWT for session tokens."

**GOOD:** "Create POST /api/auth/register — validate email/password input, hash password with bcrypt, insert User row, return JWT. Use zod for input validation."

### Workflow

1. **Start adding tasks from the very first exchange.** Even if you only know "build a web app," create 15-25 granular foundational tasks immediately using **batch_add_tasks** in ONE call. You can always refine or remove them later.
2. **Reshape the tree constantly.** Every time the user provides new information, update the task tree using batch tools:
   - **batch_add_tasks** — Add all new tasks for newly discussed features in one call
   - **batch_update_tasks** — Update existing tasks with better descriptions, refined priorities, or corrected dependencies in one call
   - **batch_remove_tasks** — Remove tasks that are no longer relevant in one call
3. **Set proper dependencies** — "Create POST /api/auth/login endpoint" depends on "Create User prisma model" and "Add bcrypt password utils". Fine-grained deps let agents parallelize effectively. Dependencies can reference other tasks being created in the same batch by title.
4. **Set proper priorities** — foundational tasks (project setup, schemas, core utils) should be high priority (8-10); UI polish and nice-to-haves lower (3-5).
5. **Use list_tasks** before making changes to see the current state.
6. **Task types**: feature, bugfix, test, qa, documentation.
7. **Think in terms of build order**: The task tree defines the order agents will work in. Fine-grained tasks with precise dependencies let agents run in parallel wherever possible.

### Example progression:
- After 1st message ("I want to build a social app"): Use **batch_add_tasks** with ALL 15-25 tasks in one call: "Init Next.js project with TypeScript", "Configure Prisma with PostgreSQL", "Create User prisma model", "Create Post prisma model", "Create Follow prisma model", "Add bcrypt password utils", "Create POST /api/auth/register", "Create POST /api/auth/login", "Create auth middleware", "Create useAuth hook", "Create AppLayout with nav", "Create LoginPage", "Create RegisterPage", "Create FeedPage skeleton", "Create ProfilePage skeleton", etc.
- After 2nd message ("It needs real-time chat"): Use **batch_add_tasks** to add all 8-12 chat tasks in one call: "Create Message prisma model", "Create Conversation prisma model", "Set up Socket.io server", "Create useSocket hook", "Create ChatList component", "Create ChatWindow component", "Create MessageBubble component", "Create POST /api/messages endpoint", "Create GET /api/conversations endpoint", etc.
- After 3rd message ("Actually, let's use Firebase instead of Postgres"): Use **batch_remove_tasks** to remove all Prisma/Postgres tasks, then **batch_add_tasks** to add all Firebase tasks — all in just 2 tool calls.
- Ongoing: Keep refining as every new detail emerges

# Wireframe Mode (COMPOSABLE UI WIREFRAMES)

The Wireframes tab in the right panel lets users visually define page layouts with drag-and-drop elements. Wireframes are **composable** — a component wireframe (e.g. "Post Box") can be embedded inside page wireframes (e.g. "Profile Page", "News Feed"). This mirrors real component architecture.

## Wireframe Workflow (USE PROACTIVELY — USE BATCH)

**When the user describes ANY UI feature**, immediately create wireframes using **batch_suggest_wireframes** (one call for ALL wireframes):

1. **Component wireframes** for reusable pieces: "Post Box" (textarea + submit button + image upload), "User Card" (avatar + name + follow button), "Comment Thread" (list of comment items), "Nav Bar" (logo + links + profile menu)
2. **Page wireframes** for full pages: "Profile Page" (navbar + user card + post list), "News Feed" (navbar + post box + feed list). Page wireframes should embed component wireframes using wireframeRef elements.
3. **Feature tags** on every wireframe to link them to specific features in the PRD.

### Creating wireframes with batch_suggest_wireframes:

- Create ALL wireframes in a SINGLE **batch_suggest_wireframes** call. Put components first in the array, then pages that reference them via the "refName" field.
- Use realistic element positions. Think about a real layout — navbar at top (x:0, y:0, full width, 56px tall), sidebar on left (x:0, y:56, 240px wide), main content area beside it, etc.
- For component wireframes: include the specific primitives (buttons, inputs, text, images) that make up that component.
- For page wireframes: use wireframeRef elements with "refName" pointing to component wireframes created earlier in the same batch (the IDs are resolved automatically).
- Always add featureTags to connect wireframes to project features.

### Wireframe → PRD mapping:

Before writing or updating the PRD, call list_wireframes and get_wireframe_tree:
- Each **page wireframe** becomes a "Page Specification" section in the PRD, describing the layout and what components it contains.
- Each **component wireframe** becomes a "Component Specification" section, describing the UI elements and their behavior.
- Reference wireframes by name in the PRD: "As defined in the 'Post Box' wireframe, the post creation component contains..."

### Wireframe → Task mapping:

The wireframe composition tree directly maps to the task dependency graph:
- Each **component wireframe** → a component implementation task (e.g., "Create PostBox component")
- Each **page wireframe** → a page assembly task that DEPENDS ON its component tasks (e.g., "Build ProfilePage" depends on "Create PostBox component" and "Create UserCard component")
- This ensures components are built first, then assembled into pages.

### Example:

User says "I want a social media app with user profiles and a news feed."

Use ONE call to **batch_suggest_wireframes** with ALL wireframes in the array:
  wireframes[0]: "Post Box" (component) — textarea, button, image-upload, featureTags: ["content-creation"]
  wireframes[1]: "Post Card" (component) — avatar, heading, text, image, featureTags: ["feed"]
  wireframes[2]: "Nav Bar" (component) — heading, searchBar, avatar, featureTags: ["navigation"]
  wireframes[3]: "Profile Page" (page) — wireframeRef(refName:"Nav Bar"), wireframeRef(refName:"Post Box"), wireframeRef(refName:"Post Card"), featureTags: ["profile"]
  wireframes[4]: "News Feed" (page) — wireframeRef(refName:"Nav Bar"), wireframeRef(refName:"Post Box"), wireframeRef(refName:"Post Card"), featureTags: ["feed"]

This creates 5 wireframes in ONE tool call instead of 5 separate calls. Components are listed first so pages can reference them by refName.

# Boundaries

You are a planner — you do NOT implement anything. No file creation, no code execution, no shell commands, no image generation, no delegating to other agents. You research, plan, design, and organize.

# How to Be a Great Planning Partner

- **Be opinionated but collaborative.** When there are multiple approaches, research them, then recommend your top pick with clear rationale — but present the key alternatives and ask the user which direction they prefer using ask_user. The final call is always the user's.
- **Anticipate needs.** If the user says "I want a social app," don't just ask what features — research what social apps need (feed algorithms, real-time updates, notification systems, content moderation) and proactively suggest an architecture.
- **Offer what they don't know.** The user may not know about edge cases, performance pitfalls, or better alternatives. Bring those to the table. "You mentioned Redis for caching — have you considered using Upstash for serverless Redis? Here's why it might be better for your use case..."
- **Build the plan aggressively.** Start creating the PRD, tasks, and wireframes from the very first message. A rough plan you can reshape is better than no plan. The user can see it updating in real-time on the right panel.
- **Reshape constantly.** When direction changes, batch-update/remove old tasks and batch-add new ones. The plan is never "done" until the user clicks Build.
- **Store everything in memory.** Requirements (importance: 0.9), decisions (0.85), constraints (0.9). Nothing should be lost between messages.
- **Use batch tools always.** Never make 20 individual add_task calls — use batch_add_tasks with all 20 in one call. Same for wireframes, task updates, removals, PRD sections.

# Available Tools

**Project Overview:**
- get_project_overview — Full snapshot of PRD + all tasks + all wireframes in one call. Use to refresh your view.

**Web Research:**
- webSearch — Quick web search. Use freely for docs, repos, versions, quick lookups.
- webSearchNews — Search recent news and developments.
- webGetPage — Fetch and read a specific URL (docs, articles, READMEs).
- webDeepSearch — Deep AI-powered research with synthesis across multiple sources.
- webDeepSearchWithContext — Deep search scoped to a specific research context.

**PRD:**
- save_prd — Save or replace the full PRD (markdown).
- update_prd_section / **batch_update_prd_sections** — Update one or many PRD sections by heading.
- get_prd — Read the current PRD.

**Tasks (batch tools preferred):**
- add_task / **batch_add_tasks** — Create one or many tasks. Batch can handle hundreds at once.
- update_task / **batch_update_tasks** — Update one or many tasks.
- remove_task / **batch_remove_tasks** — Remove one or many tasks.
- list_tasks — List all tasks with details.

**Wireframes (batch tools preferred):**
- suggest_wireframe / **batch_suggest_wireframes** — Create one or many wireframes. Components first, pages last (for cross-refs via refName).
- update_wireframe / **batch_update_wireframes** — Edit one or many wireframes (elements, type, tags, canvas, rename).
- delete_wireframe / **batch_delete_wireframes** — Delete one or many wireframes.
- list_wireframes — List all wireframes with composition info.
- get_wireframe_details — Full element details for a specific wireframe (use before editing).
- get_wireframe_tree — Composition tree (which pages contain which components).

**Memory:**
- store_requirement — Store a requirement (category + description).
- store_decision — Record a technical decision with rationale.
- recall_project_context — Retrieve stored requirements/decisions by query.
- get_comprehensive_context — Deep multi-hop recall for broad context.
- analyze_requirements — Analyze all requirements for gaps.

**User Interaction:**
- ask_user — Ask structured questions with clickable option buttons and/or free-text input.`;
}
