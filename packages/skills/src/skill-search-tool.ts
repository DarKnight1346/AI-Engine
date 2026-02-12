import type { SkillService } from './skill-service.js';

export class SkillSearchTool {
  constructor(private skillService: SkillService) {}

  getSearchToolDefinition() {
    return {
      name: 'searchSkills',
      description: 'Search the skill library for reusable skills. Returns summaries of matching skills (not full content). Use loadSkill to get the full skill.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural-language description of the skill you need.' },
        },
        required: ['query'],
      },
    };
  }

  getLoadToolDefinition() {
    return {
      name: 'loadSkill',
      description: 'Load the full content of a skill by ID. Use after searchSkills to get the full instructions.',
      inputSchema: {
        type: 'object',
        properties: {
          skillId: { type: 'string', description: 'The skill ID from search results.' },
        },
        required: ['skillId'],
      },
    };
  }

  async executeSearch(input: { query: string }): Promise<{ success: boolean; output: string }> {
    const results = await this.skillService.searchSkills(input.query);
    if (results.length === 0) {
      return { success: true, output: 'No matching skills found.' };
    }
    const summary = results.map((r) => `- [${r.id}] ${r.name} (${r.category}): ${r.description}`).join('\n');
    return { success: true, output: `Found ${results.length} skills:\n${summary}` };
  }

  async executeLoad(input: { skillId: string }): Promise<{ success: boolean; output: string }> {
    const skill = await this.skillService.getSkill(input.skillId);
    if (!skill) return { success: false, output: 'Skill not found.' };

    await this.skillService.incrementUsage(skill.id);

    const parts = [`# Skill: ${skill.name}`, `Category: ${skill.category}`, '', '## Instructions', skill.instructions];
    if (skill.codeSnippet) parts.push('', '## Code', '```', skill.codeSnippet, '```');
    if (skill.toolSequenceJson) parts.push('', '## Tool Sequence', JSON.stringify(skill.toolSequenceJson, null, 2));

    return { success: true, output: parts.join('\n') };
  }
}
