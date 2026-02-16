/**
 * Worker-side tool implementations — shell, filesystem, and Docker tools.
 *
 * These tools are registered on worker nodes and executed locally when the
 * dashboard dispatches `tool:execute` messages.  They are the implementations
 * behind the worker-bound tools defined in the ToolIndex (chat-executor.ts).
 *
 * Security: Workers are trusted execution environments.  The shell tool runs
 * arbitrary commands with the worker process's privileges.
 */

import { readFile, writeFile, readdir, stat, mkdir } from 'fs/promises';
import { join, resolve } from 'path';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import type { Tool, ToolResult } from '../types.js';

const exec = promisify(execCb);

// ---------------------------------------------------------------------------
// execShell — run arbitrary shell commands on the worker
// ---------------------------------------------------------------------------

export function createExecShellTool(): Tool {
  return {
    name: 'execShell',
    description: 'Execute a shell command on the worker node.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute.' },
      },
      required: ['command'],
    },
    execute: async (input): Promise<ToolResult> => {
      const command = String(input.command ?? '');
      if (!command) {
        return { success: false, output: 'No command provided.' };
      }

      try {
        const { stdout, stderr } = await exec(command, {
          timeout: 120_000,       // 2 minute default timeout
          maxBuffer: 10 * 1024 * 1024, // 10 MB
          shell: '/bin/bash',
        });

        const output = (stdout || '').trimEnd();
        const errors = (stderr || '').trimEnd();

        if (errors && !output) {
          return { success: true, output: errors };
        }
        if (errors) {
          return { success: true, output: `${output}\n\n[stderr]\n${errors}` };
        }
        return { success: true, output: output || '(no output)' };
      } catch (err: any) {
        // exec rejects on non-zero exit code — still return the output
        const stdout = (err.stdout || '').trimEnd();
        const stderr = (err.stderr || '').trimEnd();
        const combined = [stdout, stderr].filter(Boolean).join('\n\n[stderr]\n');
        return {
          success: false,
          output: combined || `Command failed: ${err.message}`,
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// readFile — read a file from the worker filesystem
// ---------------------------------------------------------------------------

export function createReadFileTool(): Tool {
  return {
    name: 'readFile',
    description: 'Read the contents of a file from the worker filesystem.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute file path to read.' },
      },
      required: ['path'],
    },
    execute: async (input): Promise<ToolResult> => {
      const filePath = String(input.path ?? '');
      if (!filePath) {
        return { success: false, output: 'No path provided.' };
      }

      try {
        const absPath = resolve(filePath);
        const content = await readFile(absPath, 'utf-8');
        return { success: true, output: content };
      } catch (err: any) {
        return { success: false, output: `Failed to read file: ${err.message}` };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// writeFile — write content to a file on the worker filesystem
// ---------------------------------------------------------------------------

export function createWriteFileTool(): Tool {
  return {
    name: 'writeFile',
    description: 'Write content to a file on the worker filesystem.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute file path to write.' },
        content: { type: 'string', description: 'File content to write.' },
      },
      required: ['path', 'content'],
    },
    execute: async (input): Promise<ToolResult> => {
      const filePath = String(input.path ?? '');
      const content = String(input.content ?? '');
      if (!filePath) {
        return { success: false, output: 'No path provided.' };
      }

      try {
        const absPath = resolve(filePath);
        // Ensure parent directory exists
        const dir = absPath.substring(0, absPath.lastIndexOf('/'));
        if (dir) {
          await mkdir(dir, { recursive: true });
        }
        await writeFile(absPath, content, 'utf-8');
        return { success: true, output: `File written: ${absPath}` };
      } catch (err: any) {
        return { success: false, output: `Failed to write file: ${err.message}` };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// listFiles — list directory contents on the worker filesystem
// ---------------------------------------------------------------------------

export function createListFilesTool(): Tool {
  return {
    name: 'listFiles',
    description: 'List files and directories at a given path on the worker.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path to list.' },
      },
      required: ['path'],
    },
    execute: async (input): Promise<ToolResult> => {
      const dirPath = String(input.path ?? '');
      if (!dirPath) {
        return { success: false, output: 'No path provided.' };
      }

      try {
        const absPath = resolve(dirPath);
        const entries = await readdir(absPath, { withFileTypes: true });

        const lines = entries.map((e) => {
          const type = e.isDirectory() ? 'd' : e.isSymbolicLink() ? 'l' : '-';
          return `${type} ${e.name}`;
        });

        return { success: true, output: lines.join('\n') || '(empty directory)' };
      } catch (err: any) {
        return { success: false, output: `Failed to list directory: ${err.message}` };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Convenience: get all worker filesystem/shell tools
// ---------------------------------------------------------------------------

export function getWorkerTools(): Tool[] {
  return [
    createExecShellTool(),
    createReadFileTool(),
    createWriteFileTool(),
    createListFilesTool(),
  ];
}
