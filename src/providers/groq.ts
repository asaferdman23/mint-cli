// src/providers/groq.ts
import { OpenAICompatibleProvider } from './openai-compatible.js';

export const groqProvider = new OpenAICompatibleProvider({
  providerId: 'groq',
  providerName: 'Groq',
  baseURL: 'https://api.groq.com/openai/v1',
  apiKeyConfigPath: 'providers.groq',
  modelMap: {
    'groq-llama-70b':    'llama-3.3-70b-versatile',
    'groq-llama-8b':     'llama-3.1-8b-instant',
    'groq-gpt-oss-120b': 'openai/gpt-oss-120b',
    'groq-gpt-oss-20b':  'openai/gpt-oss-20b',
  },
});
