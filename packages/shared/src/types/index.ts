// ============================================================
// Users & Teams
// ============================================================
export type UserRole = 'admin' | 'member' | 'viewer';
export type TeamRole = 'owner' | 'member' | 'viewer';

export interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  role: UserRole;
  createdAt: Date;
}

export interface Team {
  id: string;
  name: string;
  description: string | null;
  aiSensitivity: number; // 0-1
  alwaysRespondKeywords: string[];
  quietHours: { start: string; end: string; timezone: string } | null;
  createdAt: Date;
}

export interface TeamMember {
  id: string;
  teamId: string;
  userId: string;
  teamRole: TeamRole;
  joinedAt: Date;
}

export interface TeamInvite {
  id: string;
  teamId: string;
  email: string;
  token: string;
  invitedByUserId: string;
  expiresAt: Date;
  acceptedAt: Date | null;
}

// ============================================================
// Chat
// ============================================================
export type ChatSessionType = 'personal' | 'team';
export type SenderType = 'user' | 'ai';

export interface ChatSession {
  id: string;
  type: ChatSessionType;
  ownerId: string; // userId or teamId
  title: string | null;
  createdByUserId: string;
  createdAt: Date;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  senderType: SenderType;
  senderUserId: string | null;
  content: string;
  embedsJson: Record<string, unknown> | null;
  aiResponded: boolean;
  classifierConfidence: number | null;
  createdAt: Date;
}

export interface ClassifierResult {
  shouldRespond: boolean;
  confidence: number;
  reason: string;
  threadId: string | null;
  addressedTo: 'ai' | 'human' | 'ambiguous';
}

// ============================================================
// Cluster & Nodes
// ============================================================
export type NodeOS = 'darwin' | 'linux' | 'win32';
export type NodeEnvironment = 'cloud' | 'local';

export interface NodeCapabilities {
  os: NodeOS;
  hasDisplay: boolean;
  browserCapable: boolean;
  environment: NodeEnvironment;
  customTags: string[];
}

export interface ClusterNode {
  id: string;
  hostname: string;
  ip: string;
  os: NodeOS;
  environment: NodeEnvironment;
  capabilities: NodeCapabilities;
  lastHeartbeat: Date;
  isLeader: boolean;
}

export interface WorkerConfig {
  workerId: string;
  workerSecret: string;
  serverUrl: string;
  /** @deprecated Workers now connect through the dashboard WebSocket — direct DB access is no longer required */
  postgresUrl?: string;
  /** @deprecated Workers now connect through the dashboard WebSocket — direct Redis access is no longer required */
  redisUrl?: string;
  environment: NodeEnvironment;
  customTags: string[];
}

// ============================================================
// WebSocket Protocol  (Dashboard ↔ Worker)
// ============================================================

/** Messages a worker sends to the dashboard. */
export type WorkerWsMessage =
  | { type: 'auth'; token: string }
  | { type: 'heartbeat'; load: number; activeTasks: number; capabilities: NodeCapabilities }
  | { type: 'task:complete'; taskId: string; output: string; tokensUsed: number; durationMs: number }
  | { type: 'task:failed'; taskId: string; error: string }
  | { type: 'tool:result'; callId: string; success: boolean; output: string }
  | { type: 'agent:call'; callId: string; fromAgentId: string; targetAgentId: string; input: string }
  | { type: 'agent:response'; callId: string; output: string; error?: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string; taskId?: string };

/** Messages the dashboard sends to a worker. */
export type DashboardWsMessage =
  | { type: 'auth:ok'; workerId: string; config: Record<string, unknown> }
  | { type: 'auth:error'; message: string }
  | { type: 'task:assign'; taskId: string; agentId: string; input: string; agentConfig: Record<string, unknown>; userId?: string; teamId?: string }
  | { type: 'task:cancel'; taskId: string }
  | { type: 'tool:execute'; callId: string; toolName: string; input: Record<string, unknown> }
  | { type: 'agent:call'; callId: string; fromAgentId: string; input: string; agentConfig: Record<string, unknown> }
  | { type: 'agent:response'; callId: string; output: string; error?: string }
  | { type: 'config:update'; config: Record<string, unknown> }
  | { type: 'update:available'; version: string; bundleUrl: string };

// ============================================================
// Config
// ============================================================
export interface ConfigEntry {
  key: string;
  valueJson: Record<string, unknown>;
  version: number;
  updatedAt: Date;
}

// ============================================================
// API Keys & LLM
// ============================================================
export type LLMTier = 'fast' | 'standard' | 'heavy';
export type LoadBalanceStrategy = 'round-robin' | 'least-active' | 'random';

export interface ApiKey {
  id: string;
  keyEncrypted: string;
  label: string;
  isActive: boolean;
  tierMapping: Record<LLMTier, string>; // tier -> model name
  usageStats: ApiKeyUsageStats;
}

export interface ApiKeyUsageStats {
  requestCount: number;
  tokensUsed: number;
  errorCount: number;
  lastUsedAt: Date | null;
}

export interface LLMCallOptions {
  tier?: LLMTier;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  tools?: LLMToolDefinition[];
  stream?: boolean;
}

export interface LLMToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface LLMResponse {
  content: string;
  toolCalls: LLMToolCall[];
  usage: { inputTokens: number; outputTokens: number };
  model: string;
  stopReason: string;
}

export interface LLMToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string | LLMMessageContent[];
}

export type LLMMessageContent =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; mediaType: string; data: string } }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string };

// ============================================================
// Workflows & Tasks
// ============================================================
export type WorkItemStatus = 'waiting' | 'ready' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
export type DependencyType = 'blocks' | 'informs';

export interface WorkflowStage {
  name: string;
  agentId: string | null;
  transitionRules: TransitionRule[];
  slaMinutes: number | null;
}

export interface TransitionRule {
  type: 'auto' | 'manual' | 'conditional';
  condition?: string;
}

export interface Workflow {
  id: string;
  name: string;
  teamId: string | null;
  stages: WorkflowStage[];
  createdAt: Date;
}

export interface WorkItem {
  id: string;
  workflowId: string;
  currentStage: string;
  dataJson: Record<string, unknown>;
  status: WorkItemStatus;
  requiredCapabilities: Partial<NodeCapabilities> | null;
  nodeAffinity: string | null;
  assignedNode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkItemTransition {
  id: string;
  workItemId: string;
  fromStage: string;
  toStage: string;
  agentId: string | null;
  timestamp: Date;
}

export interface TaskDependency {
  id: string;
  taskId: string;
  dependsOnTaskId: string;
  dependencyType: DependencyType;
}

// ============================================================
// Agents
// ============================================================
export interface AgentDefinition {
  id: string;
  name: string;
  rolePrompt: string;
  toolConfig: AgentToolConfig;
  requiredCapabilities: Partial<NodeCapabilities> | null;
  workflowStageIds: string[];
}

export interface AgentToolConfig {
  enabledTools: string[];
  disabledTools: string[];
  customToolConfigs: Record<string, Record<string, unknown>>;
}

// ============================================================
// Skills
// ============================================================
export interface Skill {
  id: string;
  name: string;
  description: string;
  category: string;
  instructions: string;
  toolSequenceJson: Record<string, unknown>[] | null;
  codeSnippet: string | null;
  requiredCapabilities: string[];
  version: number;
  isActive: boolean;
  usageCount: number;
  createdBy: string; // 'user' | 'agent:<id>'
  createdAt: Date;
}

export interface SkillVersion {
  id: string;
  skillId: string;
  version: number;
  contentSnapshot: Record<string, unknown>;
  createdAt: Date;
}

export interface AgentPinnedSkill {
  id: string;
  agentId: string;
  skillId: string;
  workflowStageId: string | null;
  pinnedAt: Date;
}

export interface SkillSearchResult {
  id: string;
  name: string;
  description: string;
  category: string;
  relevanceScore: number;
}

// ============================================================
// Memory
// ============================================================
export type MemoryScope = 'global' | 'team' | 'personal';
export type MemoryEntryType = 'conversation' | 'knowledge' | 'reflection' | 'observation';
export type MemorySource = 'explicit' | 'conversation' | 'consolidation' | 'inference';

export interface MemoryEntry {
  id: string;
  scope: MemoryScope;
  scopeOwnerId: string | null;
  type: MemoryEntryType;
  content: string;
  importance: number; // 0-1
  strength: number; // 0-1, decays over time (Ebbinghaus curve)
  decayRate: number; // individual decay rate; lower = slower forgetting
  lastAccessedAt: Date;
  accessCount: number;
  source: MemorySource;
  createdAt: Date;
}

/** Result returned by hybrid memory search, includes computed scores */
export interface ScoredMemoryEntry extends MemoryEntry {
  similarity: number;
  effectiveStrength: number;
  recencyScore: number;
  finalScore: number;
}

export interface MemoryAssociation {
  id: string;
  sourceEntryId: string;
  targetEntryId: string;
  weight: number; // 0-1
}

export interface MemoryEmbedding {
  id: string;
  entryId: string;
  entryType: 'memory' | 'skill';
  embedding: number[];
}

// ============================================================
// Episodic Memory (Conversation Summaries)
// ============================================================
export interface ConversationSummary {
  id: string;
  sessionId: string;
  userId: string | null;
  teamId: string | null;
  summary: string;
  topics: string[];
  decisions: string[];
  messageCount: number;
  periodStart: Date;
  periodEnd: Date;
  createdAt: Date;
}

export interface UserProfile {
  id: string;
  userId: string;
  key: string;
  value: string;
  confidence: number;
  updatedAt: Date;
}

// ============================================================
// Goals
// ============================================================
export type GoalScope = 'personal' | 'team';
export type GoalPriority = 'high' | 'medium' | 'low';
export type GoalStatus = 'active' | 'paused' | 'completed';

export interface UserGoal {
  id: string;
  scope: GoalScope;
  scopeOwnerId: string;
  description: string;
  priority: GoalPriority;
  status: GoalStatus;
  sourceSessionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GoalUpdate {
  id: string;
  goalId: string;
  previousDescription: string;
  newDescription: string;
  sourceSessionId: string | null;
  updatedAt: Date;
}

// ============================================================
// Vault
// ============================================================
export type CredentialType = 'api_key' | 'login' | 'oauth' | 'generic';
export type ApprovalStatus = 'approved' | 'pending' | 'rejected';
export type VaultPermission = 'read' | 'write' | 'admin';
export type VaultAction = 'read' | 'create' | 'update' | 'delete' | 'denied';
export type ApprovalMode = 'auto' | 'notify' | 'approve';

export interface VaultCredential {
  id: string;
  name: string;
  type: CredentialType;
  encryptedData: Buffer;
  iv: Buffer;
  authTag: Buffer;
  urlPattern: string | null;
  createdBy: string; // 'user' | 'agent:<id>'
  approvalStatus: ApprovalStatus;
  createdAt: Date;
}

export interface VaultAccessPolicy {
  id: string;
  credentialId: string;
  agentId: string | null;
  workflowId: string | null;
  permissions: VaultPermission;
  grantedAt: Date;
}

export interface VaultAuditEntry {
  id: string;
  credentialId: string;
  agentId: string | null;
  action: VaultAction;
  timestamp: Date;
}

// Decrypted credential shapes
export interface DecryptedApiKey {
  serviceName: string;
  key: string;
  secret?: string;
}

export interface DecryptedLogin {
  urlPattern: string;
  username: string;
  password: string;
  totpSeed?: string;
}

export interface DecryptedOAuth {
  service: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface DecryptedGenericSecret {
  name: string;
  value: string;
}

export type DecryptedCredential = DecryptedApiKey | DecryptedLogin | DecryptedOAuth | DecryptedGenericSecret;

// ============================================================
// Planning
// ============================================================
export type PlanningStatus = 'active' | 'completed' | 'archived';
export type TaskGraphStatus = 'draft' | 'confirmed' | 'executing';

export interface PlanningSession {
  id: string;
  chatSessionId: string;
  title: string;
  status: PlanningStatus;
  createdAt: Date;
}

export interface PlanningTaskGraph {
  id: string;
  sessionId: string;
  graphJson: TaskGraphNode[];
  status: TaskGraphStatus;
  createdAt: Date;
}

export interface TaskGraphNode {
  id: string;
  title: string;
  description: string;
  workflowId: string | null;
  stage: string | null;
  nodeAffinity: string | null;
  dependencies: string[];
}

// ============================================================
// File Sync
// ============================================================
export interface NodeFile {
  id: string;
  nodeId: string;
  filePath: string;
  fileHash: string;
  sizeBytes: number;
  lastModified: Date;
}

export interface FileTransferLog {
  id: string;
  sourceNode: string;
  targetNode: string;
  filePath: string;
  sizeBytes: number;
  durationMs: number;
  timestamp: Date;
}

// ============================================================
// Scheduler
// ============================================================
export type ScheduleType = 'cron' | 'once' | 'interval';
export type ScheduledRunTrigger = 'tick' | 'recovery' | 'manual';
export type ScheduledRunStatus = 'running' | 'completed' | 'failed';

export interface ScheduledTask {
  id: string;
  name: string;
  cronExpr: string;
  scheduleType: ScheduleType;
  agentId: string | null;
  workflowId: string | null;
  goalContextId: string | null;
  configJson: Record<string, unknown>;
  nextRunAt: Date;
  isActive: boolean;
  createdFromSessionId: string | null;
  createdAt: Date;
}

export interface ScheduledTaskRun {
  id: string;
  taskId: string;
  scheduledAt: Date;
  triggeredBy: ScheduledRunTrigger;
  executedByNode: string | null;
  status: ScheduledRunStatus;
  startedAt: Date;
  finishedAt: Date | null;
  resultSummary: string | null;
}

export interface SchedulerHeartbeat {
  id: string;
  nodeId: string;
  tickedAt: Date;
}

// ============================================================
// Execution Logs
// ============================================================
export interface ExecutionLog {
  id: string;
  agentId: string;
  workItemId: string | null;
  scheduledRunId: string | null;
  input: string;
  output: string;
  tokensUsed: number;
  durationMs: number;
  createdAt: Date;
}

// ============================================================
// Browser
// ============================================================
export interface BrowserSessionInfo {
  id: string;
  name: string | null;
  persistent: boolean;
  currentUrl: string | null;
  tabCount: number;
}

export interface AccessibilityNode {
  role: string;
  name: string;
  value?: string;
  description?: string;
  children?: AccessibilityNode[];
}

export interface NetworkRequestLog {
  id: string;
  url: string;
  method: string;
  status: number;
  responseSize: number;
  durationMs: number;
  timestamp: Date;
}

export interface ConsoleLogEntry {
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  text: string;
  timestamp: Date;
}

// ============================================================
// Web Search (Serper.dev)
// ============================================================
export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
  source?: string;
}

export interface WebSearchOptions {
  /** Number of results (default 10) */
  num?: number;
  /** Country code, e.g. 'us' */
  gl?: string;
  /** Language code, e.g. 'en' */
  hl?: string;
  /** Location string, e.g. 'New York, NY' */
  location?: string;
  /** Time filter: 'qdr:h' (hour), 'qdr:d' (day), 'qdr:w' (week), 'qdr:m' (month), 'qdr:y' (year) */
  tbs?: string;
}

// ============================================================
// Events (Redis pub/sub)
// ============================================================
export type ConfigScope = 'api-keys' | 'workflows' | 'agents' | 'schedules' | 'skills' | 'general';

export interface ConfigUpdatedEvent {
  scope: ConfigScope;
  version: number;
  updatedBy: string;
  timestamp: Date;
}

export interface TaskCompletedEvent {
  workItemId: string;
  workflowId: string;
  stage: string;
  agentId: string;
  nodeId: string;
  timestamp: Date;
}

export interface SchedulerStalledEvent {
  lastTickAt: Date;
  nodeId: string;
  timestamp: Date;
}

export interface FileRequestEvent {
  requestId: string;
  filePath: string;
  sourceNodeId: string;
  targetNodeId: string;
  timestamp: Date;
}

// ============================================================
// Thinking Status (SSE)
// ============================================================
export type ThinkingPhase = 'classifying' | 'thinking' | 'responding' | 'idle';

export interface ThinkingStatus {
  sessionId: string;
  phase: ThinkingPhase;
  message: string;
  targetUserId?: string;
  timestamp: Date;
}
