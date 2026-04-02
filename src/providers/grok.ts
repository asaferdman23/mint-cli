// src/providers/grok.ts
import { OpenAICompatibleProvider } from './openai-compatible.js';

export const grokProvider = new OpenAICompatibleProvider({
  providerId: 'grok',
  providerName: 'Grok (xAI)',
  baseURL: 'https://api.x.ai/v1',
  apiKeyConfigPath: 'providers.grok',
  modelMap: {
    'grok-3':           'grok-3',
    'grok-3-fast':      'grok-3-fast',
    'grok-3-mini-fast': 'grok-3-mini-fast',
    'grok-4-beta':      'grok-4.20-beta',
  },
});
