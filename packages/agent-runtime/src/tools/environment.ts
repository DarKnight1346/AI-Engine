import type { Tool, ToolContext } from '../types.js';
import os from 'os';

export class EnvironmentTools {
  static getAll(): Tool[] {
    return [
      EnvironmentTools.getDateTime(),
      EnvironmentTools.getSystemInfo(),
      EnvironmentTools.getTaskContext(),
      EnvironmentTools.wait(),
    ];
  }

  static getDateTime(): Tool {
    return {
      name: 'getDateTime',
      description: 'Get the current date, time, timezone, day of week, and Unix timestamp.',
      inputSchema: {
        type: 'object',
        properties: {
          timezone: { type: 'string', description: 'Optional IANA timezone (e.g., America/New_York). Defaults to system timezone.' },
        },
      },
      execute: async (input) => {
        const now = new Date();
        const tz = (input.timezone as string) || Intl.DateTimeFormat().resolvedOptions().timeZone;
        const formatted = now.toLocaleString('en-US', { timeZone: tz, dateStyle: 'full', timeStyle: 'long' });
        return {
          success: true,
          output: JSON.stringify({
            iso: now.toISOString(),
            formatted,
            timezone: tz,
            dayOfWeek: now.toLocaleDateString('en-US', { weekday: 'long' }),
            unixTimestamp: Math.floor(now.getTime() / 1000),
          }),
        };
      },
    };
  }

  static getSystemInfo(): Tool {
    return {
      name: 'getSystemInfo',
      description: 'Get information about the current worker node: OS, hostname, capabilities, memory, and CPU load.',
      inputSchema: { type: 'object', properties: {} },
      execute: async (_input, context) => {
        return {
          success: true,
          output: JSON.stringify({
            nodeId: context.nodeId,
            hostname: os.hostname(),
            platform: os.platform(),
            arch: os.arch(),
            cpus: os.cpus().length,
            totalMemory: os.totalmem(),
            freeMemory: os.freemem(),
            uptime: os.uptime(),
            capabilities: context.capabilities,
          }),
        };
      },
    };
  }

  static getTaskContext(): Tool {
    return {
      name: 'getTaskContext',
      description: 'Get metadata about the current task: agent ID, work item ID, assigned node.',
      inputSchema: { type: 'object', properties: {} },
      execute: async (_input, context) => {
        return {
          success: true,
          output: JSON.stringify({
            agentId: context.agentId,
            workItemId: context.workItemId ?? null,
            nodeId: context.nodeId,
            capabilities: context.capabilities,
          }),
        };
      },
    };
  }

  static wait(): Tool {
    return {
      name: 'wait',
      description: 'Pause execution for a specified number of seconds. Useful for polling and retry patterns.',
      inputSchema: {
        type: 'object',
        properties: {
          seconds: { type: 'number', description: 'Number of seconds to wait (max 300).' },
        },
        required: ['seconds'],
      },
      execute: async (input) => {
        const seconds = Math.min(Math.max(Number(input.seconds) || 1, 0.1), 300);
        await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
        return { success: true, output: `Waited ${seconds} seconds.` };
      },
    };
  }
}
