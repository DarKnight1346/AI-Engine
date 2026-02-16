export * from './paths.js';

export const DEFAULT_CONFIG = {
  cluster: {
    heartbeatIntervalMs: 3000,
    heartbeatTtlMs: 10000,
    leaderLockTtlMs: 10000,
    leaderLockKey: 'ai-engine:leader',
  },
  scheduler: {
    tickIntervalMs: 1000,
    watchdogThresholdMs: 5000,
    watchdogMaxMissedTicks: 3,
    defaultBargeInWindowMs: 2000,
  },
  llm: {
    defaultTier: 'standard' as const,
    defaultMaxTokens: 4096,
    defaultTemperature: 0.7,
    rateLimitBackoffBaseMs: 1000,
    rateLimitBackoffMaxMs: 60000,
    defaultTierMapping: {
      fast: 'claude-3-5-haiku-20241022',
      standard: 'claude-sonnet-4-20250514',
      heavy: 'claude-opus-4-20250514',
    },
  },
  memory: {
    contextWindowTokenLimit: 180000,
    contextBudgetThreshold: 0.8,
    summarizationTriggerRatio: 0.75,
    maxRetrievedMemories: 10,
    embeddingDimension: 768,
  },
  browser: {
    poolSize: 20,
    defaultTimeoutMs: 30000,
    sessionIdleTimeoutMs: 300000,
  },
  webSearch: {
    defaultResultCount: 5,
    searchCacheTtlMs: 3600000,
    pageCacheTtlMs: 86400000,
  },
  skills: {
    searchResultLimit: 5,
    autoLearnThreshold: 3,
    maxPinnedSkillsPerAgent: 5,
  },
  vault: {
    defaultApprovalMode: 'notify' as const,
    argon2MemoryCost: 65536,
    argon2TimeCost: 3,
    argon2Parallelism: 4,
  },
  chat: {
    classifierConfidenceThreshold: 0.7,
    defaultAiSensitivity: 0.5,
    singleUserBatchWindowMs: 2000,
    multiUserBatchWindowMs: 5000,
    maxContextMessages: 15,
  },
} as const;

export type AppConfig = typeof DEFAULT_CONFIG;
