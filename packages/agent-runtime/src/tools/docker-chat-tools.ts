/**
 * Docker Chat Tools — Docker container & image tools for chat / agent mode.
 *
 * These tools provide full Docker management capabilities:
 *
 * **Global operations** (work on ANY container/image, not session-scoped):
 *   - dockerPs, dockerStop, dockerRemove, dockerLogs, dockerExecChat
 *   - dockerImages, dockerPull, dockerSystemPrune
 *
 * **Session-managed containers** (auto-cleanup when chat ends):
 *   - dockerRun creates containers that are tracked per session by default.
 *   - Set `persistent: true` to create containers that survive the session.
 *   - On chat end, the dashboard sends `docker:session:release` and the
 *     worker destroys only the non-persistent (managed) containers.
 *
 * All tools are registered on the worker and dispatched via `tool:execute`.
 */

import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import type { Tool, ToolResult } from '../types.js';

const exec = promisify(execCb);

// ---------------------------------------------------------------------------
// Session tracking — maintained per worker process
// ---------------------------------------------------------------------------

/** Map of sessionId → Set of container IDs created by that session */
const dockerSessions = new Map<string, Set<string>>();

/** Track a container as belonging to a session */
function trackContainer(sessionId: string, containerId: string): void {
  let set = dockerSessions.get(sessionId);
  if (!set) {
    set = new Set();
    dockerSessions.set(sessionId, set);
  }
  set.add(containerId);
}

/** Untrack a single container (e.g. when explicitly removed) */
function untrackContainer(sessionId: string, containerId: string): void {
  const set = dockerSessions.get(sessionId);
  if (set) {
    set.delete(containerId);
    if (set.size === 0) dockerSessions.delete(sessionId);
  }
}

/** Untrack across ALL sessions (for global remove) */
function untrackContainerGlobal(containerId: string): void {
  for (const [sessionId, set] of dockerSessions) {
    set.delete(containerId);
    if (set.size === 0) dockerSessions.delete(sessionId);
  }
}

/**
 * Clean up ALL managed containers for a Docker session.
 * Called when the chat/agent session ends.
 * Returns the number of containers cleaned up.
 */
export async function cleanupDockerSession(sessionId: string): Promise<number> {
  const containers = dockerSessions.get(sessionId);
  if (!containers || containers.size === 0) {
    dockerSessions.delete(sessionId);
    return 0;
  }

  let cleaned = 0;
  for (const containerId of containers) {
    try {
      await exec(`docker rm -f ${containerId}`, { timeout: 15_000 });
      cleaned++;
    } catch {
      // Container may already be gone — ignore
    }
  }

  dockerSessions.delete(sessionId);
  console.log(`[docker-session] Cleaned up ${cleaned}/${containers.size} containers for session ${sessionId}`);
  return cleaned;
}

/**
 * Get the set of active Docker sessions (for diagnostics / shutdown).
 */
export function getDockerSessions(): Map<string, Set<string>> {
  return dockerSessions;
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createDockerChatTools(): Tool[] {
  return [
    // Container lifecycle
    createDockerRunTool(),
    createDockerExecChatTool(),
    createDockerStopTool(),
    createDockerRemoveTool(),
    createDockerLogsTool(),
    createDockerPsTool(),
    // Image management
    createDockerImagesTool(),
    createDockerPullTool(),
    // System maintenance
    createDockerSystemPruneTool(),
  ];
}

// ---------------------------------------------------------------------------
// dockerRun — create and start a new container
// ---------------------------------------------------------------------------

function createDockerRunTool(): Tool {
  return {
    name: 'dockerRun',
    description:
      'Create and start a new Docker container. Returns the container ID. ' +
      'By default the container is managed (auto-cleaned when the chat ends). ' +
      'Set persistent=true to keep the container running after the chat session ends.',
    inputSchema: {
      type: 'object',
      properties: {
        image: {
          type: 'string',
          description: 'Docker image to use (e.g., "ubuntu:22.04", "node:20", "python:3.12").',
        },
        name: {
          type: 'string',
          description: 'Optional container name. Auto-generated if omitted.',
        },
        command: {
          type: 'string',
          description: 'Optional command to run (default: image entrypoint). Use "sleep infinity" to keep the container alive for interactive use.',
        },
        ports: {
          type: 'string',
          description: 'Port mapping (e.g., "8080:80", "3000:3000"). Supports multiple comma-separated.',
        },
        volumes: {
          type: 'string',
          description: 'Volume mount (e.g., "/host/path:/container/path"). Supports multiple comma-separated.',
        },
        env: {
          type: 'object',
          description: 'Environment variables as key-value pairs.',
        },
        workdir: {
          type: 'string',
          description: 'Working directory inside the container.',
        },
        detach: {
          type: 'boolean',
          description: 'Run in detached mode (default: true).',
        },
        persistent: {
          type: 'boolean',
          description:
            'If true, the container will NOT be automatically cleaned up when the chat session ends. ' +
            'Use this for long-lived services (databases, web servers) that should survive beyond the chat. ' +
            'Default: false (container is auto-cleaned).',
        },
        extraArgs: {
          type: 'string',
          description: 'Any additional docker run arguments (e.g., "--network host --privileged --restart unless-stopped").',
        },
      },
      required: ['image'],
    },
    execute: async (input, context): Promise<ToolResult> => {
      const image = String(input.image ?? '');
      if (!image) return { success: false, output: 'Docker image is required.' };

      const sessionId = context?.browserSessionId ?? 'default';
      const persistent = input.persistent === true;

      // Build the docker run command
      const args: string[] = ['docker', 'run'];

      // Always detach unless explicitly false
      const detach = input.detach !== false;
      if (detach) args.push('-d');

      // Session label for tracking (applied to all containers regardless
      // of persistence, useful for diagnostics)
      args.push('--label', `ai-engine-session=${sessionId}`);
      args.push('--label', `ai-engine-managed=${persistent ? 'false' : 'true'}`);

      // Container name
      if (input.name) {
        args.push('--name', String(input.name));
      }

      // Port mappings
      if (input.ports) {
        for (const mapping of String(input.ports).split(',')) {
          args.push('-p', mapping.trim());
        }
      }

      // Volume mounts
      if (input.volumes) {
        for (const mount of String(input.volumes).split(',')) {
          args.push('-v', mount.trim());
        }
      }

      // Environment variables
      if (input.env && typeof input.env === 'object') {
        for (const [key, val] of Object.entries(input.env as Record<string, string>)) {
          args.push('-e', `${key}=${val}`);
        }
      }

      // Working directory
      if (input.workdir) {
        args.push('-w', String(input.workdir));
      }

      // Extra arguments
      if (input.extraArgs) {
        args.push(...String(input.extraArgs).split(/\s+/));
      }

      // Image
      args.push(image);

      // Command
      if (input.command) {
        args.push(...String(input.command).split(/\s+/));
      }

      const cmd = args.join(' ');

      try {
        const { stdout, stderr } = await exec(cmd, {
          timeout: 120_000,
          maxBuffer: 10 * 1024 * 1024,
        });

        const containerId = (stdout || '').trim().slice(0, 64);
        if (!containerId) {
          return { success: false, output: stderr || 'docker run returned no container ID.' };
        }

        // Only track non-persistent containers for automatic cleanup
        if (!persistent) {
          trackContainer(sessionId, containerId);
        }

        const mode = persistent ? 'persistent (will NOT be auto-cleaned)' : 'managed (will be auto-cleaned when chat ends)';

        return {
          success: true,
          output: JSON.stringify({
            containerId,
            image,
            name: input.name || null,
            persistent,
            message: `Container started — ${mode}.`,
          }),
        };
      } catch (err: any) {
        const stderr = (err.stderr || '').trim();
        return { success: false, output: stderr || `docker run failed: ${err.message}` };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// dockerExecChat — execute a command inside a running container
// ---------------------------------------------------------------------------

function createDockerExecChatTool(): Tool {
  return {
    name: 'dockerExecChat',
    description:
      'Execute a command inside a running Docker container. ' +
      'Works on ANY container (managed or not). ' +
      'Use the containerId or name from dockerRun or dockerPs.',
    inputSchema: {
      type: 'object',
      properties: {
        containerId: {
          type: 'string',
          description: 'Container ID or name to execute in.',
        },
        command: {
          type: 'string',
          description: 'Shell command to execute inside the container.',
        },
        workdir: {
          type: 'string',
          description: 'Working directory inside the container.',
        },
      },
      required: ['containerId', 'command'],
    },
    execute: async (input): Promise<ToolResult> => {
      const containerId = String(input.containerId ?? '');
      const command = String(input.command ?? '');
      if (!containerId || !command) {
        return { success: false, output: 'Both containerId and command are required.' };
      }

      const args = ['docker', 'exec'];
      if (input.workdir) args.push('-w', String(input.workdir));
      args.push(containerId, 'sh', '-c', JSON.stringify(command));

      try {
        const { stdout, stderr } = await exec(args.join(' '), {
          timeout: 300_000,
          maxBuffer: 10 * 1024 * 1024,
        });

        const output = (stdout || '').trimEnd();
        const errors = (stderr || '').trimEnd();

        if (errors && !output) return { success: true, output: errors };
        if (errors) return { success: true, output: `${output}\n\n[stderr]\n${errors}` };
        return { success: true, output: output || '(no output)' };
      } catch (err: any) {
        const stdout = (err.stdout || '').trimEnd();
        const stderr = (err.stderr || '').trimEnd();
        const combined = [stdout, stderr].filter(Boolean).join('\n\n[stderr]\n');
        return { success: false, output: combined || `docker exec failed: ${err.message}` };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// dockerStop — stop a running container (global — works on any container)
// ---------------------------------------------------------------------------

function createDockerStopTool(): Tool {
  return {
    name: 'dockerStop',
    description: 'Stop a running Docker container gracefully. Works on any container.',
    inputSchema: {
      type: 'object',
      properties: {
        containerId: {
          type: 'string',
          description: 'Container ID or name to stop.',
        },
        timeout: {
          type: 'number',
          description: 'Seconds to wait before killing. Default: 10.',
        },
      },
      required: ['containerId'],
    },
    execute: async (input): Promise<ToolResult> => {
      const containerId = String(input.containerId ?? '');
      if (!containerId) return { success: false, output: 'containerId is required.' };

      const timeout = input.timeout ?? 10;

      try {
        await exec(`docker stop -t ${timeout} ${containerId}`, { timeout: 30_000 });
        return { success: true, output: `Container ${containerId} stopped.` };
      } catch (err: any) {
        return { success: false, output: `docker stop failed: ${err.stderr || err.message}` };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// dockerRemove — remove a container (global — works on any container)
// ---------------------------------------------------------------------------

function createDockerRemoveTool(): Tool {
  return {
    name: 'dockerRemove',
    description: 'Remove a Docker container. Works on any container. Use force=true to remove a running container.',
    inputSchema: {
      type: 'object',
      properties: {
        containerId: {
          type: 'string',
          description: 'Container ID or name to remove.',
        },
        force: {
          type: 'boolean',
          description: 'Force removal of running container. Default: false.',
        },
      },
      required: ['containerId'],
    },
    execute: async (input): Promise<ToolResult> => {
      const containerId = String(input.containerId ?? '');
      if (!containerId) return { success: false, output: 'containerId is required.' };

      const force = input.force ? '-f' : '';

      try {
        await exec(`docker rm ${force} ${containerId}`.trim(), { timeout: 15_000 });
        // Untrack across all sessions in case it was managed
        untrackContainerGlobal(containerId);
        return { success: true, output: `Container ${containerId} removed.` };
      } catch (err: any) {
        return { success: false, output: `docker rm failed: ${err.stderr || err.message}` };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// dockerLogs — get container logs (global)
// ---------------------------------------------------------------------------

function createDockerLogsTool(): Tool {
  return {
    name: 'dockerLogs',
    description: 'Get logs from a Docker container. Works on any container.',
    inputSchema: {
      type: 'object',
      properties: {
        containerId: {
          type: 'string',
          description: 'Container ID or name.',
        },
        tail: {
          type: 'number',
          description: 'Number of lines from the end. Default: 100.',
        },
        since: {
          type: 'string',
          description: 'Show logs since timestamp or relative (e.g., "10m", "1h").',
        },
      },
      required: ['containerId'],
    },
    execute: async (input): Promise<ToolResult> => {
      const containerId = String(input.containerId ?? '');
      if (!containerId) return { success: false, output: 'containerId is required.' };

      const tail = input.tail ?? 100;
      const args = ['docker', 'logs', '--tail', String(tail)];
      if (input.since) args.push('--since', String(input.since));
      args.push(containerId);

      try {
        const { stdout, stderr } = await exec(args.join(' '), {
          timeout: 30_000,
          maxBuffer: 10 * 1024 * 1024,
        });
        const output = (stdout || '').trimEnd();
        const errors = (stderr || '').trimEnd();
        return { success: true, output: [output, errors].filter(Boolean).join('\n') || '(no logs)' };
      } catch (err: any) {
        return { success: false, output: `docker logs failed: ${err.stderr || err.message}` };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// dockerPs — list containers (global)
// ---------------------------------------------------------------------------

function createDockerPsTool(): Tool {
  return {
    name: 'dockerPs',
    description:
      'List Docker containers on the worker. Shows ALL containers on the host, not just session-managed ones. ' +
      'Use all=true to include stopped containers. Use filter to narrow results.',
    inputSchema: {
      type: 'object',
      properties: {
        all: {
          type: 'boolean',
          description: 'Show all containers (including stopped). Default: false.',
        },
        filter: {
          type: 'string',
          description: 'Docker filter (e.g., "name=my-app", "status=running", "label=ai-engine-managed=true").',
        },
      },
    },
    execute: async (input): Promise<ToolResult> => {
      const args = ['docker', 'ps', '--format', '"table {{.ID}}\\t{{.Image}}\\t{{.Status}}\\t{{.Names}}\\t{{.Ports}}"'];
      if (input.all) args.splice(2, 0, '-a');
      if (input.filter) args.push('--filter', String(input.filter));

      try {
        const { stdout } = await exec(args.join(' '), { timeout: 15_000 });
        return { success: true, output: (stdout || '').trimEnd() || 'No containers found.' };
      } catch (err: any) {
        return { success: false, output: `docker ps failed: ${err.stderr || err.message}` };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// dockerImages — list local images (global)
// ---------------------------------------------------------------------------

function createDockerImagesTool(): Tool {
  return {
    name: 'dockerImages',
    description:
      'List Docker images on the worker. Shows all locally available images. ' +
      'Useful for checking what images are cached, their sizes, and tags.',
    inputSchema: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          description: 'Filter by reference (e.g., "node", "ubuntu", "nginx").',
        },
        all: {
          type: 'boolean',
          description: 'Show all images (including intermediates). Default: false.',
        },
      },
    },
    execute: async (input): Promise<ToolResult> => {
      const args = ['docker', 'images', '--format', '"table {{.Repository}}\\t{{.Tag}}\\t{{.ID}}\\t{{.Size}}\\t{{.CreatedSince}}"'];
      if (input.all) args.splice(2, 0, '-a');
      if (input.filter) args.push(String(input.filter));

      try {
        const { stdout } = await exec(args.join(' '), { timeout: 15_000 });
        return { success: true, output: (stdout || '').trimEnd() || 'No images found.' };
      } catch (err: any) {
        return { success: false, output: `docker images failed: ${err.stderr || err.message}` };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// dockerPull — pull an image from a registry (global)
// ---------------------------------------------------------------------------

function createDockerPullTool(): Tool {
  return {
    name: 'dockerPull',
    description: 'Pull a Docker image from a registry (Docker Hub by default).',
    inputSchema: {
      type: 'object',
      properties: {
        image: {
          type: 'string',
          description: 'Image to pull (e.g., "ubuntu:22.04", "nginx:latest", "postgres:16").',
        },
      },
      required: ['image'],
    },
    execute: async (input): Promise<ToolResult> => {
      const image = String(input.image ?? '');
      if (!image) return { success: false, output: 'Image name is required.' };

      try {
        const { stdout, stderr } = await exec(`docker pull ${image}`, {
          timeout: 300_000, // 5 min — large images take time
          maxBuffer: 10 * 1024 * 1024,
        });
        const output = (stdout || '').trimEnd();
        const errors = (stderr || '').trimEnd();
        return { success: true, output: [output, errors].filter(Boolean).join('\n') || `Pulled ${image}` };
      } catch (err: any) {
        return { success: false, output: `docker pull failed: ${err.stderr || err.message}` };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// dockerSystemPrune — clean up unused Docker resources (global)
// ---------------------------------------------------------------------------

function createDockerSystemPruneTool(): Tool {
  return {
    name: 'dockerSystemPrune',
    description:
      'Clean up unused Docker resources: stopped containers, unused networks, dangling images, and build cache. ' +
      'Use volumes=true to also remove unused volumes. Use all=true to remove all unused images (not just dangling).',
    inputSchema: {
      type: 'object',
      properties: {
        all: {
          type: 'boolean',
          description: 'Remove all unused images, not just dangling ones. Default: false.',
        },
        volumes: {
          type: 'boolean',
          description: 'Also prune unused volumes. Default: false.',
        },
      },
    },
    execute: async (input): Promise<ToolResult> => {
      const args = ['docker', 'system', 'prune', '-f'];
      if (input.all) args.push('--all');
      if (input.volumes) args.push('--volumes');

      try {
        const { stdout } = await exec(args.join(' '), {
          timeout: 120_000,
          maxBuffer: 10 * 1024 * 1024,
        });
        return { success: true, output: (stdout || '').trimEnd() || 'Docker system pruned.' };
      } catch (err: any) {
        return { success: false, output: `docker system prune failed: ${err.stderr || err.message}` };
      }
    },
  };
}
