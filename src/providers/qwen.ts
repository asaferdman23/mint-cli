// src/providers/qwen.ts
import { OpenAICompatibleProvider } from './openai-compatible.js';

export const qwenProvider = new OpenAICompatibleProvider({
  providerId: 'openrouter',
  providerName: 'Qwen (OpenRouter)',
  baseURL: 'https://openrouter.ai/api/v1',
  apiKeyConfigPath: 'providers.openrouter',
  modelMap: {
    'qwen-coder-32b': 'qwen/qwen-2.5-coder-32b-instruct',
  },
});
