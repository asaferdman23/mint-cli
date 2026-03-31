// src/providers/gemini.ts
import { GoogleGenerativeAI, type GenerativeModel } from '@google/generative-ai';
import type { Provider, CompletionRequest, CompletionResponse, ModelId, AgentStreamChunk } from './types.js';
import { calculateCost } from './router.js';
import { config } from '../utils/config.js';

const MODEL_MAP: Partial<Record<ModelId, string>> = {
  'gemini-2-flash':    'gemini-2.0-flash',
  'gemini-2-pro':      'gemini-2.0-pro-exp',
  'gemini-1-5-flash':  'gemini-1.5-flash',
  'gemini-1-5-pro':    'gemini-1.5-pro',
};

export class GeminiProvider implements Provider {
  id = 'gemini' as const;
  name = 'Gemini (Google)';
  private sdk: GoogleGenerativeAI | null = null;

  private getSDK(): GoogleGenerativeAI {
    if (this.sdk) return this.sdk;
    const sectionData = config.get('providers') as Record<string, string> | undefined;
    const apiKey = sectionData?.['gemini'];
    if (!apiKey) throw new Error('Gemini API key not configured. Run: axon config:set providers.gemini <key>');
    this.sdk = new GoogleGenerativeAI(apiKey);
    return this.sdk;
  }

  private getModel(modelId: ModelId): GenerativeModel {
    const modelString = MODEL_MAP[modelId];
    if (!modelString) throw new Error(`Model ${modelId} not supported by Gemini provider`);
    return this.getSDK().getGenerativeModel({ model: modelString });
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const model = this.getModel(request.model);
    const startTime = Date.now();

    const history = request.messages
      .filter(m => m.role !== 'system')
      .slice(0, -1)
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const lastMsg = request.messages[request.messages.length - 1];
    const chat = model.startChat({
      history,
      systemInstruction: request.systemPrompt,
    });

    const result = await chat.sendMessage(lastMsg.content);
    const content = result.response.text();
    const latency = Date.now() - startTime;

    const usage = result.response.usageMetadata;
    const inputTokens = usage?.promptTokenCount ?? 0;
    const outputTokens = usage?.candidatesTokenCount ?? 0;

    return {
      content,
      model: request.model,
      usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
      cost: calculateCost(request.model, inputTokens, outputTokens),
      latency,
    };
  }

  async *streamComplete(request: CompletionRequest): AsyncIterable<string> {
    const model = this.getModel(request.model);
    const history = request.messages
      .filter(m => m.role !== 'system')
      .slice(0, -1)
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
    const lastMsg = request.messages[request.messages.length - 1];
    const chat = model.startChat({ history, systemInstruction: request.systemPrompt });
    const result = await chat.sendMessageStream(lastMsg.content);
    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) yield text;
    }
  }

  async *streamAgent(request: CompletionRequest): AsyncIterable<AgentStreamChunk> {
    // Gemini function-calling: use generateContentStream with tools
    const modelString = MODEL_MAP[request.model];
    if (!modelString) throw new Error(`Model ${request.model} not supported by Gemini provider`);

    const tools = request.tools ? [{
      functionDeclarations: request.tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      })),
    }] : undefined;

    const model = this.getSDK().getGenerativeModel({
      model: modelString,
      tools,
      systemInstruction: request.systemPrompt,
    });

    const history = request.messages
      .filter(m => m.role !== 'system')
      .slice(0, -1)
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const lastMsg = request.messages[request.messages.length - 1];
    const chat = model.startChat({ history });
    const result = await chat.sendMessageStream(lastMsg.content);

    for await (const chunk of result.stream) {
      // Text parts
      const text = chunk.text();
      if (text) yield { type: 'text', text };

      // Function call parts
      const candidates = chunk.candidates ?? [];
      for (const candidate of candidates) {
        for (const part of candidate.content.parts) {
          if (part.functionCall) {
            yield {
              type: 'tool_call',
              toolName: part.functionCall.name,
              toolInput: part.functionCall.args as Record<string, unknown>,
              toolCallId: `gemini_${Date.now()}`,
            };
          }
        }
      }
    }
  }
}

export const geminiProvider = new GeminiProvider();
