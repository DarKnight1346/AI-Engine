import type { LLMPool } from '@ai-engine/llm';
import type { ChatMessage, ClassifierResult } from '@ai-engine/shared';
import { DEFAULT_CONFIG } from '@ai-engine/shared';

export class ChatClassifier {
  constructor(private llm: LLMPool) {}

  async classify(
    newMessage: ChatMessage,
    recentMessages: ChatMessage[],
    teamSensitivity = DEFAULT_CONFIG.chat.defaultAiSensitivity,
    alwaysRespondKeywords: string[] = []
  ): Promise<ClassifierResult> {
    // Check for @ai mention - always respond
    if (newMessage.content.toLowerCase().includes('@ai')) {
      return { shouldRespond: true, confidence: 1.0, reason: 'Explicit @ai mention', threadId: null, addressedTo: 'ai' };
    }

    // Check always-respond keywords
    const lowerContent = newMessage.content.toLowerCase();
    for (const keyword of alwaysRespondKeywords) {
      if (lowerContent.includes(keyword.toLowerCase())) {
        return { shouldRespond: true, confidence: 0.95, reason: `Contains keyword: ${keyword}`, threadId: null, addressedTo: 'ai' };
      }
    }

    // Use fast tier for classification
    const contextMessages = recentMessages.slice(-DEFAULT_CONFIG.chat.maxContextMessages);
    const conversationContext = contextMessages
      .map((m) => `[${m.senderType === 'ai' ? 'AI' : `User:${m.senderUserId ?? 'unknown'}`}] ${m.content}`)
      .join('\n');

    const response = await this.llm.call(
      [
        {
          role: 'user',
          content: `Analyze this team chat message to determine if the AI assistant should respond.

Recent conversation:
${conversationContext}

New message from User:${newMessage.senderUserId ?? 'unknown'}:
${newMessage.content}

Consider:
- Is the user asking a question or giving an instruction to the AI?
- Are they addressing the AI (even without a tag)?
- Or are they talking to another team member?
- Is this a new request or continuation of an existing thread?
- Sensitivity level: ${teamSensitivity} (0=very reserved, 1=very eager)

Respond ONLY with JSON: { "shouldRespond": boolean, "confidence": number, "reason": string, "threadId": string | null, "addressedTo": "ai" | "human" | "ambiguous" }`,
        },
      ],
      { tier: 'fast', temperature: 0.1, maxTokens: 200 }
    );

    try {
      const result = JSON.parse(response.content) as ClassifierResult;
      // Adjust confidence threshold based on sensitivity
      const threshold = DEFAULT_CONFIG.chat.classifierConfidenceThreshold * (1 - teamSensitivity * 0.4);
      if (result.confidence < threshold) {
        result.shouldRespond = false;
      }
      return result;
    } catch {
      return { shouldRespond: false, confidence: 0, reason: 'Failed to parse classifier response', threadId: null, addressedTo: 'ambiguous' };
    }
  }
}
