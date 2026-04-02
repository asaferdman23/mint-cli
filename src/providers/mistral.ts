// src/providers/mistral.ts
import { OpenAICompatibleProvider } from './openai-compatible.js';

export const mistralProvider = new OpenAICompatibleProvider({
  providerId: 'mistral',
  providerName: 'Mistral AI',
  baseURL: 'https://api.mistral.ai/v1',
  apiKeyConfigPath: 'providers.mistral',
  modelMap: {
    'mistral-small': 'mistral-small-2603',
  },
});
