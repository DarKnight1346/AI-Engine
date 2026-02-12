import { z } from 'zod';

// ============================================================
// Auth schemas
// ============================================================
export const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1).max(100),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export const createTeamSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

export const inviteToTeamSchema = z.object({
  teamId: z.string().uuid(),
  email: z.string().email(),
});

// ============================================================
// Chat schemas
// ============================================================
export const sendMessageSchema = z.object({
  sessionId: z.string().uuid(),
  content: z.string().min(1).max(50000),
});

export const createChatSessionSchema = z.object({
  type: z.enum(['personal', 'team']),
  ownerId: z.string().uuid(),
  title: z.string().max(200).optional(),
});

// ============================================================
// Workflow schemas
// ============================================================
export const workflowStageSchema = z.object({
  name: z.string().min(1),
  agentId: z.string().uuid().nullable(),
  transitionRules: z.array(z.object({
    type: z.enum(['auto', 'manual', 'conditional']),
    condition: z.string().optional(),
  })),
  slaMinutes: z.number().positive().nullable(),
});

export const createWorkflowSchema = z.object({
  name: z.string().min(1).max(200),
  teamId: z.string().uuid().nullable(),
  stages: z.array(workflowStageSchema).min(1),
});

export const createWorkItemSchema = z.object({
  workflowId: z.string().uuid(),
  dataJson: z.record(z.unknown()),
  requiredCapabilities: z.record(z.unknown()).nullable().optional(),
  nodeAffinity: z.string().uuid().nullable().optional(),
});

// ============================================================
// Agent schemas
// ============================================================
export const createAgentSchema = z.object({
  name: z.string().min(1).max(200),
  rolePrompt: z.string().min(1),
  toolConfig: z.object({
    enabledTools: z.array(z.string()),
    disabledTools: z.array(z.string()),
    customToolConfigs: z.record(z.record(z.unknown())),
  }),
  requiredCapabilities: z.record(z.unknown()).nullable().optional(),
  workflowStageIds: z.array(z.string()),
});

// ============================================================
// Skill schemas
// ============================================================
export const createSkillSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1),
  category: z.string().min(1),
  instructions: z.string().min(1),
  toolSequenceJson: z.array(z.record(z.unknown())).nullable().optional(),
  codeSnippet: z.string().nullable().optional(),
  requiredCapabilities: z.array(z.string()).optional(),
});

// ============================================================
// Vault schemas
// ============================================================
export const createCredentialSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(['api_key', 'login', 'oauth', 'generic']),
  data: z.record(z.unknown()),
  urlPattern: z.string().optional(),
});

// ============================================================
// Scheduler schemas
// ============================================================
export const createScheduledTaskSchema = z.object({
  name: z.string().min(1).max(200),
  cronExpr: z.string().optional(),
  scheduleType: z.enum(['cron', 'once', 'interval']),
  naturalLanguage: z.string().optional(),
  agentId: z.string().uuid().optional(),
  workflowId: z.string().uuid().optional(),
  configJson: z.record(z.unknown()).optional(),
});

// ============================================================
// Goal schemas
// ============================================================
export const createGoalSchema = z.object({
  scope: z.enum(['personal', 'team']),
  scopeOwnerId: z.string().uuid(),
  description: z.string().min(1),
  priority: z.enum(['high', 'medium', 'low']),
});

// ============================================================
// Config schemas
// ============================================================
export const addApiKeySchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1).max(100),
  tierMapping: z.object({
    fast: z.string(),
    standard: z.string(),
    heavy: z.string(),
  }).optional(),
});

export const workerConfigSchema = z.object({
  workerId: z.string().uuid(),
  workerSecret: z.string(),
  serverUrl: z.string().url(),
  postgresUrl: z.string(),
  redisUrl: z.string(),
  environment: z.enum(['cloud', 'local']),
  customTags: z.array(z.string()),
});

// ============================================================
// LLM schemas
// ============================================================
export const llmCallOptionsSchema = z.object({
  tier: z.enum(['fast', 'standard', 'heavy']).optional(),
  maxTokens: z.number().positive().optional(),
  temperature: z.number().min(0).max(1).optional(),
  systemPrompt: z.string().optional(),
  stream: z.boolean().optional(),
});
