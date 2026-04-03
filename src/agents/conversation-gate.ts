export interface ConversationBypass {
  response: string;
  reason: 'greeting' | 'acknowledgement' | 'help' | 'vague';
}

const TASK_HINTS =
  /\b(fix|add|change|update|remove|delete|refactor|implement|create|build|debug|test|review|explain|inspect|search|find|compare|run|deploy|auth|login|landing|page|component|route|api|file|bug|error|issue|diff|cli|repo|project)\b|[/.#]|\.([cm]?[jt]sx?|py|go|rs|md|json|ya?ml|toml|css|html)\b/i;

const GREETING_PATTERN =
  /^(hey+|hi+|hello+|yo+|sup|what'?s up|good (morning|afternoon|evening))(?:[!?.\s]*)$/i;

const ACK_PATTERN =
  /^(thanks|thank you|thx|ok(?:ay)?|cool|nice|got it|sounds good)(?:[!?.\s]*)$/i;

const HELP_PATTERN = /^help(?:[!?.\s]*)$/i;

export function getConversationBypass(task: string): ConversationBypass | null {
  const normalized = task.trim();
  if (!normalized) return null;

  if (TASK_HINTS.test(normalized)) {
    return null;
  }

  if (GREETING_PATTERN.test(normalized)) {
    return {
      reason: 'greeting',
      response: 'Hey. Tell me what you want to inspect, explain, or change in this repo.',
    };
  }

  if (ACK_PATTERN.test(normalized)) {
    return {
      reason: 'acknowledgement',
      response: 'Ready when you are. Tell me what you want to inspect or change next.',
    };
  }

  if (HELP_PATTERN.test(normalized)) {
    return {
      reason: 'help',
      response: 'Tell me the bug, file, or feature you want me to work on, and I will inspect the repo.',
    };
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length <= 2 && normalized.length <= 20) {
    return {
      reason: 'vague',
      response: 'Tell me what you want to inspect, explain, or change in this repo.',
    };
  }

  return null;
}
