import type { SkillService } from './skill-service.js';
import { DEFAULT_CONFIG } from '@ai-engine/shared';

interface ToolCallPattern {
  toolSequence: string[];
  count: number;
  lastSeen: Date;
  exampleInputs: Record<string, unknown>[];
}

export class SkillAutoLearner {
  private patterns: Map<string, ToolCallPattern> = new Map();

  constructor(private skillService: SkillService) {}

  recordToolSequence(agentId: string, tools: Array<{ name: string; input: Record<string, unknown> }>): void {
    const key = tools.map((t) => t.name).join('->');
    const existing = this.patterns.get(key);

    if (existing) {
      existing.count++;
      existing.lastSeen = new Date();
      if (existing.exampleInputs.length < 3) {
        existing.exampleInputs.push(tools[0]?.input ?? {});
      }
    } else {
      this.patterns.set(key, {
        toolSequence: tools.map((t) => t.name),
        count: 1,
        lastSeen: new Date(),
        exampleInputs: [tools[0]?.input ?? {}],
      });
    }
  }

  async checkAndPropose(): Promise<Array<{ sequence: string[]; count: number }>> {
    const proposals: Array<{ sequence: string[]; count: number }> = [];

    for (const [key, pattern] of this.patterns) {
      if (pattern.count >= DEFAULT_CONFIG.skills.autoLearnThreshold) {
        proposals.push({ sequence: pattern.toolSequence, count: pattern.count });
        // Reset count after proposal
        pattern.count = 0;
      }
    }

    return proposals;
  }

  async createDraftSkill(name: string, description: string, toolSequence: string[]): Promise<string> {
    const skill = await this.skillService.createSkill({
      name,
      description,
      category: 'auto-learned',
      instructions: `This skill was auto-learned from repeated usage.\n\nTool sequence: ${toolSequence.join(' -> ')}`,
      toolSequenceJson: toolSequence.map((t) => ({ tool: t })),
      createdBy: 'agent:auto-learner',
    });
    return skill.id;
  }
}
