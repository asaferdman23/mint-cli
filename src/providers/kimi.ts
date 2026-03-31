// src/providers/kimi.ts
import { OpenAICompatibleProvider } from './openai-compatible.js';

export const kimiProvider = new OpenAICompatibleProvider({
  providerId: 'kimi',
  providerName: 'Kimi (Moonshot AI)',
  baseURL: 'https://api.moonshot.cn/v1',
  apiKeyConfigPath: 'providers.kimi',
  modelMap: {
    'kimi-k2':          'kimi-k2-0711-preview',
    'moonshot-v1-8k':   'moonshot-v1-8k',
    'moonshot-v1-32k':  'moonshot-v1-32k',
  },
});
