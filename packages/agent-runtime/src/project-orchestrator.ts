import type { LLMPool } from '@ai-engine/llm';
import type { ContextBuilder } from '@ai-engine/memory';
import { getDb } from '@ai-engine/db';
import { AgentRunner, type AgentTaskInput } from './agent-runner.js';
import { GitService } from './services/git-service.js';
import { SshKeyService } from './services/ssh-key-service.js';
import type Redis from 'ioredis';

/** Sanitize a string into a valid Git branch name. */
function sanitizeBranchName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9/_-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

/**
 * ProjectOrchestrator manages the lifecycle of a project build using swarm agents.
 * 
 * Inspired by Anthropic's parallel Claude approach:
 * - Multiple agents work in parallel on different tasks
 * - Agents use atomic locks to claim tasks (preventing conflicts)
 * - Each agent runs in its own context window
 * - Agents automatically pick next available task when done
 * - Runs continuously until all tasks are complete or project is paused
 *
 * Git + Docker workflow (Docker containers run on WORKERS, not the dashboard):
 * - Dashboard creates the Git repo when a project starts building
 * - Dashboard dispatches Docker tasks to workers via Redis → WorkerHub → WebSocket
 * - Workers create Docker containers, clone the repo, create branches
 * - The LLM loop (AgentRunner) runs on the dashboard; tool calls are routed
 *   to the worker's Docker container via the WorkerHub
 * - Workers finalize (commit/push/merge) and destroy containers when tasks complete
 */
export class ProjectOrchestrator {
  private activeProjects = new Map<string, ProjectSwarm>();
  private gitService: GitService;
  /** Separate Redis client for publishing (the main one is used for subscribe) */
  private redisPub: Redis | null = null;

  constructor(
    private llm: LLMPool,
    private contextBuilder: ContextBuilder,
    private redis: Redis,
    private nodeId: string
  ) {
    this.gitService = GitService.getInstance();

    // Listen for project start/stop commands
    this.setupEventListeners();
  }

  private setupEventListeners() {
    // Subscribe to project control events
    this.redis.subscribe('project:start', 'project:stop', (err) => {
      if (err) console.error('Failed to subscribe to project events:', err);
    });

    this.redis.on('message', async (channel, message) => {
      const data = JSON.parse(message);
      
      if (channel === 'project:start') {
        await this.startProject(data.projectId, data.config);
      } else if (channel === 'project:stop') {
        await this.stopProject(data.projectId);
      }
    });
  }

  /** Get or create a separate Redis client for publishing. */
  private async getPublisher(): Promise<Redis> {
    if (!this.redisPub) {
      this.redisPub = this.redis.duplicate();
    }
    return this.redisPub;
  }

  /**
   * Start a project build with swarm agents.
   * The Git repo is created by the build API before this is called.
   * Docker containers are created on workers, not the dashboard.
   */
  async startProject(projectId: string, config: { agentCount?: number; model?: string } = {}) {
    if (this.activeProjects.has(projectId)) {
      console.log(`Project ${projectId} is already running`);
      return;
    }

    const db = getDb();
    const project = await db.project.findUnique({ where: { id: projectId } });
    
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    if (project.status !== 'building') {
      throw new Error(`Project must be in building status to start. Current status: ${project.status}`);
    }

    // Ensure SSH keys exist (will be distributed to workers by the hub)
    const sshKeyService = SshKeyService.getInstance();
    await sshKeyService.ensureKeyPair();

    // Get Git repo path (created by the build API)
    const projectConfig = (project.config as any) ?? {};
    const repoPath = projectConfig.git?.repoPath ?? this.gitService.getRepoPath(projectId);

    const agentCount = config.agentCount ?? 4;
    const pub = await this.getPublisher();

    const swarm = new ProjectSwarm(
      projectId,
      agentCount,
      this.llm,
      this.contextBuilder,
      this.redis,
      pub,
      this.nodeId,
      config,
      repoPath,
    );

    this.activeProjects.set(projectId, swarm);
    
    // Start the swarm
    await swarm.start();

    // Log
    await db.projectLog.create({
      data: {
        projectId,
        level: 'info',
        message: `Started project with ${agentCount} agents (Git: ${repoPath}). Docker containers will run on workers.`,
      },
    });
  }

  /**
   * Stop a project (pause).
   * Tells workers to clean up their Docker containers via Redis.
   */
  async stopProject(projectId: string) {
    const swarm = this.activeProjects.get(projectId);
    if (swarm) {
      await swarm.stop();
      this.activeProjects.delete(projectId);
    }

    // Tell workers to clean up Docker containers for this project
    // The WorkerHub listens for this and broadcasts to all workers
    try {
      const pub = await this.getPublisher();
      await pub.publish('docker:cleanup', JSON.stringify({ projectId }));
    } catch (err: any) {
      console.warn(`[orchestrator] Failed to publish docker:cleanup for ${projectId}:`, err.message);
    }
  }

  /**
   * Get active project status
   */
  getProjectStatus(projectId: string) {
    const swarm = this.activeProjects.get(projectId);
    return swarm?.getStatus();
  }

  /**
   * Clean up all resources on shutdown.
   */
  async shutdown() {
    for (const [projectId, swarm] of this.activeProjects) {
      await swarm.stop();
      // Tell workers to clean up
      try {
        const pub = await this.getPublisher();
        await pub.publish('docker:cleanup', JSON.stringify({ projectId }));
      } catch {}
    }
    this.activeProjects.clear();
    if (this.redisPub) {
      await this.redisPub.quit().catch(() => {});
    }
  }
}

/**
 * ProjectSwarm manages a team of agents working on a single project
 */
class ProjectSwarm {
  private agents: SwarmAgent[] = [];
  private running = false;

  constructor(
    private projectId: string,
    private agentCount: number,
    private llm: LLMPool,
    private contextBuilder: ContextBuilder,
    private redis: Redis,
    /** Separate Redis client for publishing (subscribe client can't publish) */
    private redisPub: Redis,
    private nodeId: string,
    private config: any,
    private repoPath: string,
  ) {}

  async start() {
    this.running = true;
    const db = getDb();

    // Define specialized agent roles (inspired by Anthropic's approach)
    const roles = this.defineAgentRoles(this.agentCount);

    // Spawn agents with specialized roles
    for (let i = 0; i < this.agentCount; i++) {
      const role = roles[i];
      
      const agentRecord = await db.projectAgent.create({
        data: {
          projectId: this.projectId,
          agentId: `agent-${this.projectId.slice(0, 8)}-${i}`,
          nodeId: this.nodeId,
          role: role.type,
          status: 'idle',
          contextId: `ctx-${Date.now()}-${i}`,
          statsJson: {
            tasksCompleted: 0,
            tasksFailed: 0,
            tokensUsed: { input: 0, output: 0 },
            averageTaskDuration: 0,
          },
        },
      });

      const agent = new SwarmAgent(
        agentRecord.id,
        agentRecord.agentId,
        this.projectId,
        role,
        this.llm,
        this.contextBuilder,
        this.redis,
        this.redisPub,
        this.nodeId,
        this.config,
        this.repoPath,
      );

      this.agents.push(agent);
      
      // Start agent loop (non-blocking)
      agent.run().catch((err) => {
        console.error(`Agent ${agent.id} crashed:`, err);
      });
    }

    await db.projectLog.create({
      data: {
        projectId: this.projectId,
        level: 'success',
        message: `Swarm started with ${this.agentCount} agents (${roles.map(r => r.type).join(', ')})`,
      },
    });
  }

  /**
   * Define agent roles based on team size
   * Most agents are generalists, but some specialize (like Anthropic's approach)
   */
  private defineAgentRoles(count: number): Array<{ type: string; description: string }> {
    const roles = [];
    
    // Most agents are generalists working on features
    const generalCount = Math.max(1, count - Math.min(3, Math.floor(count / 4)));
    for (let i = 0; i < generalCount; i++) {
      roles.push({
        type: 'general',
        description: 'General-purpose development agent working on features and bug fixes',
      });
    }

    // Add specialized agents if we have enough agents
    if (count >= 3) {
      roles.push({
        type: 'qa',
        description: 'QA specialist - focuses on testing, finding bugs, and ensuring quality',
      });
    }
    if (count >= 4) {
      roles.push({
        type: 'documentation',
        description: 'Documentation specialist - maintains code comments and technical docs',
      });
    }
    if (count >= 6) {
      roles.push({
        type: 'code_quality',
        description: 'Code quality specialist - refactors duplicate code and improves architecture',
      });
    }

    return roles;
  }

  async stop() {
    this.running = false;
    await Promise.all(this.agents.map((a) => a.stop()));
    
    const db = getDb();
    await db.projectLog.create({
      data: {
        projectId: this.projectId,
        level: 'info',
        message: 'Swarm stopped',
      },
    });
  }

  getStatus() {
    return {
      running: this.running,
      agents: this.agents.map((a) => a.getStatus()),
    };
  }
}

/**
 * SwarmAgent is a single agent in the swarm that continuously works on tasks.
 * 
 * Docker containers run on WORKERS, not the dashboard. When a task needs Docker:
 *   1. Dashboard publishes a `docker:task:dispatch` Redis event
 *   2. WorkerHub picks it up and dispatches to a Docker-capable worker
 *   3. Worker creates a container, clones repo, creates a branch
 *   4. Dashboard's AgentRunner runs the LLM loop; tool calls are routed
 *      to the worker's container via the WorkerHub
 *   5. Dashboard publishes `docker:task:finalize` when done
 *   6. Worker commits/pushes/merges and destroys the container
 */
class SwarmAgent {
  private running = false;
  private currentTask: string | null = null;

  constructor(
    public id: string,
    private agentId: string,
    private projectId: string,
    private role: { type: string; description: string },
    private llm: LLMPool,
    private contextBuilder: ContextBuilder,
    private redis: Redis,
    /** Separate Redis publisher (the subscribe client can't publish) */
    private redisPub: Redis,
    private nodeId: string,
    private config: any,
    private repoPath: string,
  ) {}

  async run() {
    this.running = true;
    const db = getDb();

    while (this.running) {
      try {
        // 1. Check if project is complete
        const allTasksComplete = await this.checkProjectComplete();
        if (allTasksComplete) {
          await db.projectLog.create({
            data: {
              projectId: this.projectId,
              agentId: this.agentId,
              level: 'success',
              message: `Agent ${this.agentId}: All tasks complete! Project finished.`,
            },
          });
          await this.updateStatus('idle');
          
          // Check if we should mark project as completed
          await this.checkAndCompleteProject();
          break; // Exit the loop
        }

        // 2. Find and lock next available task
        const task = await this.claimNextTask();
        
        if (!task) {
          // No tasks available, wait and check again
          await this.updateStatus('waiting');
          await this.sleep(5000);
          continue;
        }

        this.currentTask = task.id;
        await this.updateStatus('working');

        // 3. Execute the task
        await this.executeTask(task);

      } catch (error: any) {
        console.error(`Agent ${this.agentId} error:`, error);
        await db.projectLog.create({
          data: {
            projectId: this.projectId,
            agentId: this.agentId,
            level: 'error',
            message: `Agent error: ${error.message}`,
          },
        });
        await this.sleep(10000); // Wait before retrying
      }
    }

    await this.updateStatus('stopped');
  }

  /**
   * Check if all tasks in the project are complete
   */
  private async checkProjectComplete(): Promise<boolean> {
    const db = getDb();
    const pendingTasks = await db.projectTask.findFirst({
      where: {
        projectId: this.projectId,
        status: { in: ['pending', 'locked', 'in_progress'] },
      },
    });
    return !pendingTasks;
  }

  /**
   * Mark project as completed if all agents are done
   */
  private async checkAndCompleteProject() {
    const db = getDb();
    
    // Check if all agents are idle/stopped
    const activeAgents = await db.projectAgent.findFirst({
      where: {
        projectId: this.projectId,
        status: { in: ['working', 'waiting'] },
      },
    });

    if (!activeAgents) {
      // All agents are done, mark project complete
      await db.project.update({
        where: { id: this.projectId },
        data: {
          status: 'completed',
          completedAt: new Date(),
        },
      });

      await db.projectLog.create({
        data: {
          projectId: this.projectId,
          level: 'success',
          message: 'Project completed! All tasks finished successfully.',
        },
      });
    }
  }

  /**
   * Atomically claim the next available task
   */
  private async claimNextTask(): Promise<any | null> {
    const db = getDb();

    // Get available tasks (no dependencies blocking them)
    const tasks = await db.projectTask.findMany({
      where: {
        projectId: this.projectId,
        status: 'pending',
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });

      // Try to lock each task until we succeed
    for (const task of tasks) {
      // Skip tasks not matching agent's role (if specialized)
      if (this.role.type !== 'general') {
        // Specialized agents focus on their task types
        const roleTaskTypes: Record<string, string[]> = {
          'qa': ['test', 'qa'],
          'documentation': ['documentation'],
          'code_quality': ['bugfix', 'feature'], // Code quality agents refactor existing code
        };
        
        const allowedTypes = roleTaskTypes[this.role.type];
        if (allowedTypes && !allowedTypes.includes(task.taskType)) {
          continue; // Skip tasks not matching this role
        }
      }

      // Check if dependencies are met
      // task.dependencies is stored as Json in Prisma, so cast to string[]
      const deps = Array.isArray(task.dependencies) ? (task.dependencies as string[]) : [];
      if (deps.length > 0) {
        const depTasks = await db.projectTask.findMany({
          where: {
            projectId: this.projectId,
            title: { in: deps },
          },
        });
        
        // Skip if any dependency is not completed
        if (depTasks.some((t: { status: string }) => t.status !== 'completed')) {
          continue;
        }
      }

      // Try to lock atomically (implements the "file lock" pattern from Anthropic article)
      const result = await db.projectTask.updateMany({
        where: {
          id: task.id,
          status: 'pending',
          lockedBy: null,
        },
        data: {
          status: 'locked',
          lockedBy: this.agentId,
          lockedAt: new Date(),
        },
      });

      if (result.count > 0) {
        // Successfully locked!
        await db.projectLog.create({
          data: {
            projectId: this.projectId,
            agentId: this.agentId,
            taskId: task.id,
            level: 'info',
            message: `[${this.role.type}] Locked task: ${task.title}`,
          },
        });
        return task;
      }
    }

    return null; // No tasks available
  }

  /**
   * Execute a task.
   * Dispatches Docker-based tasks to workers via Redis → WorkerHub → WebSocket.
   * Falls back to direct (non-Docker) execution if no workers are available.
   */
  private async executeTask(task: any) {
    const db = getDb();
    const startTime = Date.now();

    try {
      // Update to in_progress
      await db.projectTask.update({
        where: { id: task.id },
        data: {
          status: 'in_progress',
          assignedAgentId: this.agentId,
          startedAt: new Date(),
        },
      });

      // Get project details for context
      const project = await db.project.findUnique({ where: { id: this.projectId } });

      // Try Docker on a worker first, fall back to direct mode
      const dispatched = await this.tryDispatchToWorker(task, project, startTime);
      if (!dispatched) {
        await this.executeTaskDirect(task, project, startTime);
      }

    } catch (error: any) {
      // Mark failed
      await db.projectTask.update({
        where: { id: task.id },
        data: {
          status: 'failed',
          errorMessage: error.message,
        },
      });

      await db.projectLog.create({
        data: {
          projectId: this.projectId,
          agentId: this.agentId,
          taskId: task.id,
          level: 'error',
          message: `Task failed: ${task.title} - ${error.message}`,
        },
      });

      await this.updateStats({ input: 0, output: 0 }, Date.now() - startTime, false);

      // Tell workers to clean up the container for this task (best effort)
      try {
        await this.redisPub.publish('docker:task:cleanup', JSON.stringify({
          taskId: task.id,
          projectId: this.projectId,
        }));
      } catch {}
    } finally {
      this.currentTask = null;
    }
  }

  /**
   * Dispatch a task to a Docker-capable worker via Redis.
   *
   * Flow:
   *   1. Publish `docker:task:dispatch` → WorkerHub picks it up
   *   2. WorkerHub sends `docker:task:assign` to a worker via WebSocket
   *   3. Worker creates a Docker container, clones repo, creates branch
   *   4. Worker runs the AgentRunner loop inside the container
   *   5. Worker commits, merges, cleans up, and reports `docker:task:complete`
   *   6. WorkerHub publishes `docker:task:result:{taskId}` on Redis
   *   7. This method picks up the result and returns
   *
   * Returns true if the task was dispatched and completed on a worker,
   * or false if no Docker workers are available (caller should fall back).
   */
  private async tryDispatchToWorker(task: any, project: any, startTime: number): Promise<boolean> {
    const db = getDb();
    const branchName = sanitizeBranchName(`task/${task.id.slice(0, 8)}-${task.title}`);

    // Build the config the worker needs to create the container
    const containerConfig = {
      image: (this.config?.docker?.image as string) ?? 'ai-engine-worker:latest',
      repoPath: this.repoPath,
      workDir: '/workspace',
      branchName,
      envVars: {
        PROJECT_NAME: project?.name ?? 'unknown',
        TASK_TITLE: task.title,
        TASK_TYPE: task.taskType,
      },
      memoryLimit: (this.config?.docker?.memoryLimit as string) ?? '4g',
      cpuLimit: (this.config?.docker?.cpuLimit as string) ?? '2.0',
    };

    // Build the prompt the worker's agent will use
    const taskPrompt = this.buildTaskPrompt(task, project);
    const rolePrompt = this.getRolePrompt();

    const dockerTaskPrompt = `${taskPrompt}

## Git Workflow
- You are working on branch: **${branchName}**
- Your working directory is: /workspace/project
- All changes will be committed and merged to main when the task is complete
- You are running inside an isolated Docker container — install any dependencies you need

## Container Info
- Image: ${containerConfig.image}
- Branch: ${branchName}
`;

    await db.projectLog.create({
      data: {
        projectId: this.projectId,
        agentId: this.agentId,
        taskId: task.id,
        level: 'info',
        message: `Dispatching task to Docker worker: ${task.title} (branch: ${branchName})`,
      },
    });

    // Subscribe to the result channel for this task BEFORE dispatching
    const resultChannel = `docker:task:result:${task.id}`;
    const resultPromise = this.waitForRedisMessage(resultChannel, 600_000); // 10 min timeout

    // Publish the dispatch event — the WorkerHub will route it to a worker
    await this.redisPub.publish('docker:task:dispatch', JSON.stringify({
      taskId: task.id,
      projectId: this.projectId,
      agentId: this.agentId,
      rolePrompt,
      containerConfig,
      taskPrompt: dockerTaskPrompt,
      repoUrl: this.repoPath, // local bare repo path or remote URL
    }));

    // Wait for the worker to report back
    let result: any;
    try {
      result = await resultPromise;
    } catch (err: any) {
      // Timeout or no worker picked it up
      await db.projectLog.create({
        data: {
          projectId: this.projectId,
          agentId: this.agentId,
          taskId: task.id,
          level: 'warn',
          message: `Docker dispatch failed or timed out: ${err.message}. Falling back to direct mode.`,
        },
      });
      return false;
    }

    // Process the result from the worker
    const duration = Date.now() - startTime;

    if (result.error === 'no_docker_workers') {
      // No Docker workers available, fall back
      return false;
    }

    if (result.success) {
      await db.projectTask.update({
        where: { id: task.id },
        data: {
          status: result.merged ? 'completed' : 'failed',
          completedAt: new Date(),
          result: `${result.output ?? ''}\n\n[Git: ${result.filesChanged ?? 0} files changed, ${result.commitsCreated ?? 0} commits, merged: ${result.merged ?? false}]`,
          errorMessage: result.merged ? null : 'Branch merge failed — manual resolution may be needed',
        },
      });

      await db.projectLog.create({
        data: {
          projectId: this.projectId,
          agentId: this.agentId,
          taskId: task.id,
          level: result.merged ? 'success' : 'warn',
          message: `Completed task on worker: ${task.title} (${(duration / 1000).toFixed(1)}s, worker: ${result.workerId ?? 'unknown'}, merged: ${result.merged ?? false})`,
          metadata: { branchName, workerId: result.workerId, filesChanged: result.filesChanged, commitsCreated: result.commitsCreated },
        },
      });

      await this.updateStats(result.tokensUsed ?? { input: 0, output: 0 }, duration, result.merged ?? false);
    } else {
      throw new Error(result.error ?? 'Docker task failed on worker');
    }

    return true;
  }

  /**
   * Wait for a single message on a Redis pub/sub channel, with timeout.
   */
  private waitForRedisMessage(channel: string, timeoutMs: number): Promise<any> {
    return new Promise((resolve, reject) => {
      // Create a temporary subscriber
      const sub = this.redis.duplicate();
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          sub.unsubscribe(channel).catch(() => {});
          sub.quit().catch(() => {});
          reject(new Error(`Timeout waiting for ${channel}`));
        }
      }, timeoutMs);

      sub.subscribe(channel, (err) => {
        if (err && !settled) {
          settled = true;
          clearTimeout(timer);
          sub.quit().catch(() => {});
          reject(err);
        }
      });

      sub.on('message', (_ch: string, message: string) => {
        if (_ch === channel && !settled) {
          settled = true;
          clearTimeout(timer);
          sub.unsubscribe(channel).catch(() => {});
          sub.quit().catch(() => {});
          try {
            resolve(JSON.parse(message));
          } catch {
            resolve(message);
          }
        }
      });
    });
  }

  /**
   * Execute a task directly on the dashboard (no Docker) — fallback mode.
   * Used when no Docker-capable workers are available.
   */
  private async executeTaskDirect(task: any, project: any, startTime: number) {
    const db = getDb();

    await db.projectLog.create({
      data: {
        projectId: this.projectId,
        agentId: this.agentId,
        taskId: task.id,
        level: 'info',
        message: `Started task (direct mode, no Docker worker available): ${task.title}`,
      },
    });

    // Create agent runner for this task
    const agentRunner = new AgentRunner(
      this.llm,
      this.contextBuilder,
      {
        nodeId: this.nodeId,
        maxIterations: 50,
        llmTier: 'standard',
        capabilities: {
          os: 'linux' as const,
          hasDisplay: false,
          browserCapable: false,
          environment: 'cloud' as const,
          customTags: ['swarm-agent'],
        },
      },
      this.redis
    );

    // Build task prompt
    const taskPrompt = this.buildTaskPrompt(task, project);

    // Build role-specific prompt
    const rolePrompt = this.getRolePrompt();
    
    // Execute
    const result = await agentRunner.run({
      agent: {
        id: this.agentId,
        name: `Project Agent ${this.agentId} (${this.role.type})`,
        rolePrompt,
        toolConfig: { enabledTools: [], disabledTools: [], customToolConfigs: {} },
        requiredCapabilities: null,
        workflowStageIds: [],
      },
      taskDetails: taskPrompt,
      workItemId: task.id,
    });

    const duration = Date.now() - startTime;

    if (result.success) {
      // Mark completed
      await db.projectTask.update({
        where: { id: task.id },
        data: {
          status: 'completed',
          completedAt: new Date(),
          result: result.output,
        },
      });

      await db.projectLog.create({
        data: {
          projectId: this.projectId,
          agentId: this.agentId,
          taskId: task.id,
          level: 'success',
          message: `Completed task: ${task.title} (${(duration / 1000).toFixed(1)}s)`,
        },
      });

      // Update agent stats
      await this.updateStats(result.tokensUsed, duration, true);
    } else {
      throw new Error(result.output);
    }
  }

  private getRolePrompt(): string {
    const prompts: Record<string, string> = {
      general: `You are an expert software engineer working autonomously on a project. You are part of a swarm of agents working in parallel. 

Your focus: Implement features and fix bugs with high-quality code, proper error handling, and testing.

Key principles:
- Write clean, maintainable code
- Add comprehensive error handling
- Include inline documentation (code comments, JSDoc)
- Test your implementation
- Keep output concise - log verbose information to files
- After completing your task, the system will automatically assign you the next one`,

      qa: `You are a QA specialist agent working autonomously on testing and quality assurance.

Your focus: Find bugs, write tests, verify implementations, and ensure code quality.

Key principles:
- Write comprehensive test cases
- Focus on edge cases and error scenarios
- Verify that features work as specified in the PRD
- Report issues clearly with reproduction steps
- Focus on tasks of type 'test' and 'qa'`,

      documentation: `You are a documentation specialist agent working autonomously on code documentation.

Your focus: Maintain clear inline documentation, JSDoc comments, and technical explanations.

Key principles:
- Add JSDoc to functions and classes
- Document complex logic with inline comments
- Explain "why" not just "what"
- Keep documentation up-to-date with code changes
- NO separate markdown files - documentation goes in code comments`,

      code_quality: `You are a code quality specialist agent working autonomously on refactoring and improvements.

Your focus: Eliminate duplicate code, improve architecture, and enhance code quality.

Key principles:
- Identify and consolidate duplicate functionality
- Refactor complex functions into smaller, reusable pieces
- Improve naming and code organization
- Maintain backward compatibility
- Make incremental improvements`,

      architecture: `You are an architecture specialist agent working autonomously on system design.

Your focus: Improve overall architecture, design patterns, and system structure.

Key principles:
- Evaluate design decisions from a high level
- Suggest architectural improvements
- Ensure proper separation of concerns
- Maintain consistency across the codebase`,
    };

    return prompts[this.role.type] || prompts.general;
  }

  private buildTaskPrompt(task: any, project: any): string {
    return `
# Project: ${project?.name ?? 'Unknown'}

${project?.prd ? `## PRD\n${project.prd}\n\n` : ''}

## Your Role
You are an autonomous agent working as part of a swarm on this project. Multiple agents are working in parallel on different tasks. Your job is to complete your assigned task with high quality, then you'll automatically receive the next task.

## Current Task
**Title:** ${task.title}
**Type:** ${task.taskType}
**Priority:** ${task.priority}

**Description:**
${task.description}

## Instructions
1. **Complete the task** according to the PRD and project requirements
2. **Write high-quality code** with proper error handling and testing
3. **Document your work** in code comments (not separate markdown files)
4. **Test your implementation** to ensure it works correctly
5. **Track progress** - maintain a progress log if the task is complex
6. **Handle errors gracefully** - if you encounter issues, document them

## Output Format
Provide a clear summary of:
1. What you implemented
2. Files created/modified
3. Testing performed
4. Any issues encountered
5. Recommendations for follow-up tasks

**CRITICAL:** Keep your output concise. Avoid printing thousands of lines of debug output - log important information to files instead.

## Project Context
- Other agents are working on different tasks in parallel
- Tasks may have dependencies - ensure prerequisite tasks are completed
- Your task is locked to you - no other agent will work on it
- After completion, the system will automatically assign you the next available task
`.trim();
  }

  private async updateStatus(status: string) {
    const db = getDb();
    await db.projectAgent.update({
      where: { id: this.id },
      data: {
        status,
        currentTask: this.currentTask,
        lastActiveAt: new Date(),
      },
    });
  }

  private async updateStats(tokensUsed: { input: number; output: number }, duration: number, success: boolean) {
    const db = getDb();
    const agent = await db.projectAgent.findUnique({ where: { id: this.id } });
    
    if (agent) {
      const stats = agent.statsJson as any;
      stats.tasksCompleted += success ? 1 : 0;
      stats.tasksFailed += success ? 0 : 1;
      stats.tokensUsed.input += tokensUsed.input;
      stats.tokensUsed.output += tokensUsed.output;
      
      const totalTasks = stats.tasksCompleted + stats.tasksFailed;
      stats.averageTaskDuration = 
        (stats.averageTaskDuration * (totalTasks - 1) + duration) / totalTasks;

      await db.projectAgent.update({
        where: { id: this.id },
        data: { statsJson: stats },
      });
    }
  }

  async stop() {
    this.running = false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getStatus() {
    return {
      id: this.id,
      agentId: this.agentId,
      running: this.running,
      currentTask: this.currentTask,
    };
  }
}
