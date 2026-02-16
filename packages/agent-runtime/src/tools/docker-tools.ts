/**
 * Docker tools — agent tools for managing Docker containers on worker nodes.
 *
 * These tools are ONLY available in build/SWARM mode. They allow agents to
 * create containers, execute commands, read/write files, and finalize
 * (commit/merge) inside isolated Docker environments on remote workers.
 *
 * All operations are routed through the DockerDispatcher interface, which
 * maps tool calls to the correct worker via the WorkerHub.
 */

import type { Tool } from '../types.js';
import type { DockerDispatcher, DockerContainerConfig } from '@ai-engine/shared';

/**
 * Create all Docker tools bound to a specific DockerDispatcher and project context.
 *
 * @param dispatcher - Routes Docker operations to the correct worker/container
 * @param projectId  - The project these tools operate on
 * @param repoUrl    - Git repository URL or path for cloning into containers
 */
export function createDockerTools(
  dispatcher: DockerDispatcher,
  projectId: string,
  repoUrl: string,
): Tool[] {
  return [
    createContainerTool(dispatcher, projectId, repoUrl),
    dockerExecTool(dispatcher),
    dockerReadFileTool(dispatcher),
    dockerWriteFileTool(dispatcher),
    dockerListFilesTool(dispatcher),
    dockerFinalizeTool(dispatcher),
    dockerDestroyTool(dispatcher),
    dockerListContainersTool(dispatcher, projectId),
  ];
}

// ---------------------------------------------------------------------------
// docker_create_container
// ---------------------------------------------------------------------------

function createContainerTool(dispatcher: DockerDispatcher, projectId: string, repoUrl: string): Tool {
  return {
    name: 'docker_create_container',
    description:
      'Create a new Docker container on a worker node for an isolated build task. ' +
      'The container will have the project repo cloned and a feature branch created. ' +
      'Containers for the same project are co-located on the same worker when possible. ' +
      'Returns the containerId and workerId.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Unique task ID this container is for. Used to route subsequent commands.',
        },
        branchName: {
          type: 'string',
          description: 'Git branch name to create inside the container (e.g., "task/abc12345-add-auth").',
        },
        image: {
          type: 'string',
          description: 'Docker image to use. Defaults to "ai-engine-worker:latest".',
        },
        memoryLimit: {
          type: 'string',
          description: 'Container memory limit (e.g., "4g"). Optional.',
        },
        cpuLimit: {
          type: 'string',
          description: 'Container CPU limit (e.g., "2.0"). Optional.',
        },
      },
      required: ['taskId', 'branchName'],
    },
    execute: async (input) => {
      const taskId = input.taskId as string;
      const branchName = input.branchName as string;
      const image = (input.image as string) || 'ai-engine-worker:latest';

      const config: DockerContainerConfig = {
        image,
        repoPath: repoUrl,
        workDir: '/workspace',
        branchName,
        envVars: {
          PROJECT_ID: projectId,
          TASK_ID: taskId,
          BRANCH_NAME: branchName,
        },
        memoryLimit: (input.memoryLimit as string) || '4g',
        cpuLimit: (input.cpuLimit as string) || '2.0',
      };

      try {
        const result = await dispatcher.createContainer({
          projectId,
          taskId,
          config,
          repoUrl,
        });
        return {
          success: true,
          output: JSON.stringify({
            containerId: result.containerId,
            workerId: result.workerId,
            taskId,
            branchName,
            image,
          }),
        };
      } catch (err: any) {
        return { success: false, output: `Failed to create container: ${err.message}` };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// docker_exec
// ---------------------------------------------------------------------------

function dockerExecTool(dispatcher: DockerDispatcher): Tool {
  return {
    name: 'docker_exec',
    description:
      'Execute a shell command inside a Docker container. This is the primary tool for ' +
      'all build operations: installing dependencies, running tests, compiling code, etc. ' +
      'The command runs in the container\'s /workspace/project directory by default.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Task ID identifying the target container.',
        },
        command: {
          type: 'string',
          description: 'Shell command to execute (runs via sh -c).',
        },
        workDir: {
          type: 'string',
          description: 'Working directory inside the container. Defaults to /workspace/project.',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in seconds. Defaults to 300 (5 minutes).',
        },
      },
      required: ['taskId', 'command'],
    },
    execute: async (input) => {
      const taskId = input.taskId as string;
      const command = input.command as string;
      const workDir = (input.workDir as string) || '/workspace/project';
      const timeout = ((input.timeout as number) || 300) * 1000;

      try {
        const result = await dispatcher.executeDockerTool(
          taskId,
          'docker_exec',
          { command: `cd ${workDir} && ${command}` },
          timeout,
        );
        return result;
      } catch (err: any) {
        return { success: false, output: `Docker exec failed: ${err.message}` };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// docker_read_file
// ---------------------------------------------------------------------------

function dockerReadFileTool(dispatcher: DockerDispatcher): Tool {
  return {
    name: 'docker_read_file',
    description:
      'Read the contents of a file inside a Docker container. ' +
      'Paths are relative to /workspace/project unless absolute.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Task ID identifying the target container.',
        },
        path: {
          type: 'string',
          description: 'File path to read (relative to /workspace/project or absolute).',
        },
        maxLines: {
          type: 'number',
          description: 'Maximum number of lines to return. Omit for full file.',
        },
      },
      required: ['taskId', 'path'],
    },
    execute: async (input) => {
      const taskId = input.taskId as string;
      const filePath = input.path as string;
      const maxLines = input.maxLines as number | undefined;

      const absPath = filePath.startsWith('/') ? filePath : `/workspace/project/${filePath}`;
      let command = `cat "${absPath}"`;
      if (maxLines) {
        command = `head -n ${maxLines} "${absPath}"`;
      }

      try {
        return await dispatcher.executeDockerTool(taskId, 'docker_exec', { command });
      } catch (err: any) {
        return { success: false, output: `Failed to read file: ${err.message}` };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// docker_write_file
// ---------------------------------------------------------------------------

function dockerWriteFileTool(dispatcher: DockerDispatcher): Tool {
  return {
    name: 'docker_write_file',
    description:
      'Write content to a file inside a Docker container. Creates parent directories if needed. ' +
      'Paths are relative to /workspace/project unless absolute.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Task ID identifying the target container.',
        },
        path: {
          type: 'string',
          description: 'File path to write (relative to /workspace/project or absolute).',
        },
        content: {
          type: 'string',
          description: 'File content to write.',
        },
        append: {
          type: 'boolean',
          description: 'If true, append to the file instead of overwriting. Defaults to false.',
        },
      },
      required: ['taskId', 'path', 'content'],
    },
    execute: async (input) => {
      const taskId = input.taskId as string;
      const filePath = input.path as string;
      const content = input.content as string;
      const append = input.append as boolean;

      const absPath = filePath.startsWith('/') ? filePath : `/workspace/project/${filePath}`;

      // Use a heredoc approach to handle multi-line content safely
      const operator = append ? '>>' : '>';
      const escapedContent = content.replace(/'/g, "'\\''");
      const command = `mkdir -p "$(dirname "${absPath}")" && printf '%s' '${escapedContent}' ${operator} "${absPath}"`;

      try {
        const result = await dispatcher.executeDockerTool(taskId, 'docker_exec', { command });
        if (result.success) {
          return { success: true, output: `File written: ${absPath}` };
        }
        return result;
      } catch (err: any) {
        return { success: false, output: `Failed to write file: ${err.message}` };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// docker_list_files
// ---------------------------------------------------------------------------

function dockerListFilesTool(dispatcher: DockerDispatcher): Tool {
  return {
    name: 'docker_list_files',
    description:
      'List files and directories inside a Docker container. ' +
      'Paths are relative to /workspace/project unless absolute.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Task ID identifying the target container.',
        },
        path: {
          type: 'string',
          description: 'Directory path to list. Defaults to /workspace/project.',
        },
        recursive: {
          type: 'boolean',
          description: 'If true, list recursively. Defaults to false.',
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum depth for recursive listing. Defaults to 3.',
        },
      },
      required: ['taskId'],
    },
    execute: async (input) => {
      const taskId = input.taskId as string;
      const dirPath = (input.path as string) || '/workspace/project';
      const recursive = input.recursive as boolean;
      const maxDepth = (input.maxDepth as number) || 3;

      const absPath = dirPath.startsWith('/') ? dirPath : `/workspace/project/${dirPath}`;
      let command: string;

      if (recursive) {
        command = `find "${absPath}" -maxdepth ${maxDepth} -not -path '*/node_modules/*' -not -path '*/.git/*' | head -500`;
      } else {
        command = `ls -la "${absPath}"`;
      }

      try {
        return await dispatcher.executeDockerTool(taskId, 'docker_exec', { command });
      } catch (err: any) {
        return { success: false, output: `Failed to list files: ${err.message}` };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// docker_finalize
// ---------------------------------------------------------------------------

function dockerFinalizeTool(dispatcher: DockerDispatcher): Tool {
  return {
    name: 'docker_finalize',
    description:
      'Finalize a Docker container task: stage all changes, commit, push the branch, ' +
      'pull latest main, and merge to main. The container is destroyed after successful merge.\n\n' +
      'If there is a merge conflict, the tool returns success=false with mergeConflict=true and ' +
      'the list of conflicting files. The container stays alive so you can:\n' +
      '1. Fix the conflicts on your branch using docker_exec\n' +
      '2. Test the fixes\n' +
      '3. Call docker_finalize again to retry the merge',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Task ID identifying the target container.',
        },
        commitMessage: {
          type: 'string',
          description: 'Git commit message describing the changes.',
        },
      },
      required: ['taskId', 'commitMessage'],
    },
    execute: async (input) => {
      const taskId = input.taskId as string;
      const commitMessage = input.commitMessage as string;

      try {
        const result = await dispatcher.finalizeContainer(taskId, commitMessage);
        const resultData: Record<string, unknown> = {
          merged: result.merged,
          branchName: result.branchName,
          filesChanged: result.filesChanged,
          commitsCreated: result.commitsCreated,
          output: result.output,
        };

        // Pass through merge conflict details if present
        const rawResult = result as any;
        if (rawResult.mergeConflict) {
          resultData.mergeConflict = true;
          resultData.conflictFiles = rawResult.conflictFiles;
        }

        return {
          success: result.merged,
          output: JSON.stringify(resultData),
        };
      } catch (err: any) {
        return { success: false, output: `Finalization failed: ${err.message}` };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// docker_destroy
// ---------------------------------------------------------------------------

function dockerDestroyTool(dispatcher: DockerDispatcher): Tool {
  return {
    name: 'docker_destroy',
    description:
      'Destroy a Docker container without finalizing (no commit/merge). ' +
      'Use this to clean up failed or abandoned containers.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Task ID identifying the container to destroy.',
        },
      },
      required: ['taskId'],
    },
    execute: async (input) => {
      const taskId = input.taskId as string;

      try {
        await dispatcher.destroyContainer(taskId);
        return { success: true, output: `Container for task ${taskId} destroyed.` };
      } catch (err: any) {
        return { success: false, output: `Failed to destroy container: ${err.message}` };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// docker_list_containers
// ---------------------------------------------------------------------------

function dockerListContainersTool(dispatcher: DockerDispatcher, projectId: string): Tool {
  return {
    name: 'docker_list_containers',
    description:
      'List all active Docker containers for the current project across all workers. ' +
      'Shows container status, branch name, and which worker each container is on.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    execute: async () => {
      try {
        const containers = await dispatcher.listProjectContainers(projectId);
        return {
          success: true,
          output: JSON.stringify({
            projectId,
            count: containers.length,
            containers: containers.map(c => ({
              taskId: c.taskId,
              containerName: c.containerName,
              status: c.status,
              branchName: c.branchName,
              createdAt: c.createdAt,
            })),
          }),
        };
      } catch (err: any) {
        return { success: false, output: `Failed to list containers: ${err.message}` };
      }
    },
  };
}
