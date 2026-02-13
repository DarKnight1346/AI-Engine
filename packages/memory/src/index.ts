export { MemoryService } from './memory-service.js';
export type { HybridWeights } from './memory-service.js';
export { GoalTracker } from './goal-tracker.js';
export { ContextBuilder } from './context-builder.js';
export type { AgentContext } from './context-builder.js';
export { EmbeddingService } from './embedding-service.js';
export { ConsolidationService } from './consolidation-service.js';
export type { ConsolidationResult } from './consolidation-service.js';
export {
  computeEffectiveStrength,
  computeRecencyScore,
  computeFrequencyScore,
  onRecall,
  onBatchRecall,
  persistDecay,
} from './decay-engine.js';
