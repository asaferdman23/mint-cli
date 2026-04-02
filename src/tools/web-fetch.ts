import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from './types.js';

const DEFAULT_MAX_LENGTH = 16_000;
const FETCH_TIMEOUT = 10_000;

const parameters = z.object({
  url: z.string().url().describe('HTTP or HTTPS URL to fetch'),
  maxLength: z.number().optional().describe('Maximum number of characters to return (default 16000)'),
});

export const webFetchTool: Tool = {
  name: 'web_fetch',
  description: 'Fetch a URL and return extracted text content. Blocks localhost and non-HTTP URLs.',
  parameters,

  async execute(params: z.infer<typeof parameters>, _ctx: ToolContext): Promise<ToolResult> {
    try {
      const url = validateFetchUrl(params.url);
      const maxLength = params.maxLength ?? DEFAULT_MAX_LENGTH;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

      try {
        const response = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            'user-agent': 'mint-cli/0.1.0',
            accept: 'text/plain,text/html,application/json;q=0.9,*/*;q=0.8',
          },
        });

        if (!response.ok) {
          return { success: false, output: '', error: `HTTP ${response.status} ${response.statusText}` };
        }

        const contentType = response.headers.get('content-type') ?? '';
        const body = await response.text();
        const text = extractText(body, contentType);
        const truncated = truncateText(text, maxLength);
        return { success: true, output: truncated };
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { success: false, output: '', error: 'Fetch timed out after 10000ms' };
      }
      return { success: false, output: '', error: err instanceof Error ? err.message : String(err) };
    }
  },
};

function validateFetchUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS URLs are allowed.');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname === '::1' || hostname === '[::1]') {
    throw new Error('Localhost URLs are blocked.');
  }

  return parsed.toString();
}

function extractText(body: string, contentType: string): string {
  if (!/html/i.test(contentType) && !/<html[\s>]/i.test(body)) {
    return body.trim();
  }

  const withoutScripts = body
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');

  const withBreaks = withoutScripts
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|main|header|footer|aside|li|tr|h[1-6])>/gi, '\n');

  const withoutTags = withBreaks.replace(/<[^>]+>/g, ' ');
  const decoded = decodeHtmlEntities(withoutTags);

  return decoded
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  return text.slice(0, maxLength) + '\n... [truncated]';
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num: string) => String.fromCodePoint(parseInt(num, 10)));
}
