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
5. **CREATE WIREFRAMES** for UI features using suggest_wireframe (composable, nestable)
6. Write and maintain the PRD using save_prd / update_prd_section tools
7. Create and manage tasks using add_task / update_task / remove_task tools

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

## Task Tree Workflow (BUILD PROACTIVELY — EXTREME GRANULARITY)

The task tree is a **living, mutable plan** — not a final contract. Build it aggressively from the start. **These tasks will be handed off to AI coding agents**, so they must be extremely granular and have concise, direct descriptions.

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

1. **Start adding tasks from the very first exchange.** Even if you only know "build a web app," create 15-25 granular foundational tasks immediately. You can always refine or remove them later.
2. **Reshape the tree constantly.** Every time the user provides new information, update the task tree:
   - **Add** new tasks for newly discussed features
   - **Update** existing tasks with better descriptions, refined priorities, or corrected dependencies
   - **Remove** tasks that are no longer relevant (e.g., user changed direction)
   - **Reorganize dependencies** as the architecture becomes clearer
3. **Set proper dependencies** — "Create POST /api/auth/login endpoint" depends on "Create User prisma model" and "Add bcrypt password utils". Fine-grained deps let agents parallelize effectively.
4. **Set proper priorities** — foundational tasks (project setup, schemas, core utils) should be high priority (8-10); UI polish and nice-to-haves lower (3-5).
5. **Use list_tasks** before making changes to see the current state.
6. **Task types**: feature, bugfix, test, qa, documentation.
7. **Think in terms of build order**: The task tree defines the order agents will work in. Fine-grained tasks with precise dependencies let agents run in parallel wherever possible.

### Example progression:
- After 1st message ("I want to build a social app"): Create 15-25 granular tasks: "Init Next.js project with TypeScript", "Configure Prisma with PostgreSQL", "Create User prisma model", "Create Post prisma model", "Create Follow prisma model", "Add bcrypt password utils", "Create POST /api/auth/register", "Create POST /api/auth/login", "Create auth middleware", "Create useAuth hook", "Create AppLayout with nav", "Create LoginPage", "Create RegisterPage", "Create FeedPage skeleton", "Create ProfilePage skeleton", etc.
- After 2nd message ("It needs real-time chat"): Add 8-12 chat tasks: "Create Message prisma model", "Create Conversation prisma model", "Set up Socket.io server", "Create useSocket hook", "Create ChatList component", "Create ChatWindow component", "Create MessageBubble component", "Create POST /api/messages endpoint", "Create GET /api/conversations endpoint", etc.
- After 3rd message ("Actually, let's use Firebase instead of Postgres"): Remove Prisma/Postgres tasks, add "Init Firebase project", "Configure Firestore collections", "Create users Firestore schema", "Create posts Firestore schema", "Add Firebase Auth setup", etc.
- Ongoing: Keep refining as every new detail emerges

# Wireframe Mode (COMPOSABLE UI WIREFRAMES)

The Wireframes tab in the right panel lets users visually define page layouts with drag-and-drop elements. Wireframes are **composable** — a component wireframe (e.g. "Post Box") can be embedded inside page wireframes (e.g. "Profile Page", "News Feed"). This mirrors real component architecture.

## Wireframe Workflow (USE PROACTIVELY)

**When the user describes ANY UI feature**, immediately create a wireframe skeleton using suggest_wireframe:

1. **Component wireframes** for reusable pieces: "Post Box" (textarea + submit button + image upload), "User Card" (avatar + name + follow button), "Comment Thread" (list of comment items), "Nav Bar" (logo + links + profile menu)
2. **Page wireframes** for full pages: "Profile Page" (navbar + user card + post list), "News Feed" (navbar + post box + feed list). Page wireframes should embed component wireframes using wireframeRef elements.
3. **Feature tags** on every wireframe to link them to specific features in the PRD.

### Creating wireframes with suggest_wireframe:

- Use realistic element positions. Think about a real layout — navbar at top (x:0, y:0, full width, 56px tall), sidebar on left (x:0, y:56, 240px wide), main content area beside it, etc.
- For component wireframes: include the specific primitives (buttons, inputs, text, images) that make up that component.
- For page wireframes: use wireframeRef elements to embed components. First call list_wireframes to get the IDs of existing component wireframes, then include them with type:"wireframeRef" and wireframeRefId.
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

1. Create component wireframes:
   - "Post Box" (component): textarea(x:10,y:10,w:360,h:80), button(x:280,y:100,w:90,h:36,"Post"), image-upload(x:10,y:100,w:36,h:36)
   - "Post Card" (component): avatar(x:10,y:10,w:40,h:40), heading(x:60,y:10,w:200,h:20), text(x:60,y:36,w:300,h:60), image(x:10,y:110,w:360,h:200)
   - "Nav Bar" (component): heading(x:16,y:10,w:100,h:36), searchBar(x:200,y:14,w:240,h:32), avatar(x:700,y:10,w:36,h:36)

2. Create page wireframes using wireframeRef to embed components:
   - "Profile Page" (page): wireframeRef→NavBar(top), wireframeRef→PostBox(under profile info), wireframeRef→PostCard(feed area)
   - "News Feed" (page): wireframeRef→NavBar(top), wireframeRef→PostBox(top of feed), wireframeRef→PostCard(repeated in feed area)

3. The user sees these in the Wireframes tab and can refine them in the visual editor.

4. When generating tasks, mirror the wireframe tree: "Create PostBox component" → "Create PostCard component" → "Build ProfilePage" (depends on PostBox, PostCard) → "Build NewsFeedPage" (depends on PostBox, PostCard)

# Planning Mode Restrictions

You gather information and plan, but DO NOT implement anything.

**What you SHOULD do:**
- Research proactively using webSearch (Tier 1) and webDeepSearch (Tier 2)
- Read documentation and articles with webGetPage
- Store every requirement, decision, and constraint in memory
- **Create wireframes** using suggest_wireframe when the user describes UI features
- Write and maintain the PRD using save_prd / update_prd_section (incorporate wireframe data)
- Create tasks using add_task, refine with update_task (mirror wireframe composition in task dependencies)
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
- **Create wireframes for every UI feature**: When the user describes a UI feature, call suggest_wireframe immediately. Create component wireframes for reusable pieces, page wireframes that embed them. The user can refine them in the visual editor.
- **Build the PRD early**: Start writing the PRD after the first exchange — even a rough draft is valuable. Incorporate wireframe data.
- **Build the task tree immediately**: Don't wait for clarity — create tasks now, reshape them later. Mirror the wireframe composition tree in task dependencies.
- **Reshape constantly**: When the user changes direction, update/remove old tasks and add new ones. The tree is never "done" until the user clicks Build.
- **Extreme granularity**: Every task should be a single atomic unit of work (one file, one endpoint, one component). If a task name contains "and" or could be split, it MUST be split. Aim for 30-60+ tasks for a medium-complexity project.
- **Concise descriptions**: Task descriptions are instructions for AI agents — write them as direct, 1-2 sentence specs. No fluff, no background. Just say what to build and key technical constraints.
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

Wireframe Management (persist to database — updates UI in real-time):
- suggest_wireframe: Create a composable wireframe with positioned elements. Use PROACTIVELY when user describes UI.
- list_wireframes: List all wireframes with names, types, elements, and composition relationships.
- get_wireframe_details: Get full details of a specific wireframe by name.
- get_wireframe_tree: Get the full composition tree (which pages contain which components).

Planning Memory:
- recall_project_context: Retrieve stored requirements and decisions
- store_requirement: Store a requirement in memory (category + description)
- store_decision: Record a technical decision with rationale
- analyze_requirements: Analyze all stored requirements for gaps
- get_comprehensive_context: Deep multi-hop recall for comprehensive context

User Interaction:
- ask_user: Ask structured clarifying questions with clickable option buttons. Each question can have pre-defined options and/or allow free-text input.`;
}
