/**
 * Markdown-to-ANSI renderer for terminal output.
 * Produces chalk-colored strings, one per logical display line.
 * Inspired by opencode's Glamour-based rendering.
 */
import chalk from 'chalk';
import type { Theme } from '../theme/theme.js';
import { Icons } from './icons.js';

// ─── Syntax highlighting ────────────────────────────────────────────────────

const KEYWORDS: Record<string, Set<string>> = {
  ts: new Set(['const','let','var','function','return','if','else','for','while','do',
    'class','import','export','from','as','async','await','new','this','typeof',
    'instanceof','in','of','try','catch','finally','throw','extends','implements',
    'interface','type','enum','namespace','readonly','static','public','private',
    'protected','abstract','override','get','set','break','continue','default',
    'case','switch','delete','void','null','undefined','true','false','yield',
    'super','keyof','infer','never','any','unknown','string','number','boolean',
    'object','symbol','bigint']),
  python: new Set(['def','class','import','from','as','return','if','elif','else',
    'for','while','in','not','and','or','is','with','try','except','finally',
    'raise','pass','break','continue','lambda','yield','global','nonlocal','del',
    'assert','True','False','None','async','await','print','self','super']),
  go: new Set(['func','var','const','type','struct','interface','import','package',
    'return','if','else','for','range','switch','case','default','go','chan','map',
    'make','new','append','len','cap','close','panic','recover','defer','select',
    'fallthrough','goto','break','continue','true','false','nil','string','int',
    'int64','int32','float64','float32','bool','byte','rune','error']),
  rust: new Set(['fn','let','mut','const','static','struct','enum','trait','impl',
    'use','mod','pub','crate','self','super','return','if','else','for','while',
    'loop','match','break','continue','true','false','None','Some','Ok','Err',
    'String','Vec','Option','Result','Box','Rc','Arc','async','await','move']),
};

function getKeywords(lang: string): Set<string> {
  return KEYWORDS[lang] || KEYWORDS['ts'];
}

type TokenKind = 'comment' | 'string' | 'keyword' | 'number' | 'type' | 'function' | 'operator' | 'plain';

interface Token { kind: TokenKind; value: string; }

function tokenizeLine(line: string, lang: string): Token[] {
  const tokens: Token[] = [];
  const kws = getKeywords(lang);
  let i = 0;

  while (i < line.length) {
    // Line comment
    const lineCommentPrefixes = (lang === 'python' || lang === 'bash' || lang === 'sh' || lang === 'shell') ? ['#'] : ['//'];
    let matched = false;
    for (const prefix of lineCommentPrefixes) {
      if (line.startsWith(prefix, i)) {
        tokens.push({ kind: 'comment', value: line.slice(i) });
        i = line.length;
        matched = true;
        break;
      }
    }
    if (matched) break;

    // Block comment /* ... */
    if (line.startsWith('/*', i)) {
      const end = line.indexOf('*/', i + 2);
      const val = end >= 0 ? line.slice(i, end + 2) : line.slice(i);
      tokens.push({ kind: 'comment', value: val });
      i = end >= 0 ? end + 2 : line.length;
      continue;
    }

    // HTML/JSX comment <!-- -->
    if (line.startsWith('<!--', i)) {
      const end = line.indexOf('-->', i + 4);
      const val = end >= 0 ? line.slice(i, end + 3) : line.slice(i);
      tokens.push({ kind: 'comment', value: val });
      i = end >= 0 ? end + 3 : line.length;
      continue;
    }

    const ch = line[i];

    // String literals
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      let end = i + 1;
      while (end < line.length) {
        if (line[end] === '\\') { end += 2; continue; }
        if (line[end] === quote) { end++; break; }
        end++;
      }
      tokens.push({ kind: 'string', value: line.slice(i, end) });
      i = end;
      continue;
    }

    // Numbers (only at word boundary)
    if (/\d/.test(ch) && (i === 0 || !/[\w$]/.test(line[i - 1]))) {
      const m = line.slice(i).match(/^(?:0x[\da-fA-F]+|0b[01]+|0o[0-7]+|\d+\.?\d*(?:[eE][+-]?\d+)?)/);
      if (m) {
        tokens.push({ kind: 'number', value: m[0] });
        i += m[0].length;
        continue;
      }
    }

    // Identifiers
    if (/[a-zA-Z_$]/.test(ch)) {
      const m = line.slice(i).match(/^[a-zA-Z_$][a-zA-Z0-9_$]*/);
      if (m) {
        const word = m[0];
        i += word.length;
        // skip whitespace to detect function call
        let j = i;
        while (j < line.length && (line[j] === ' ' || line[j] === '\t')) j++;
        if (line[j] === '(') {
          tokens.push({ kind: 'function', value: word });
        } else if (kws.has(word)) {
          tokens.push({ kind: 'keyword', value: word });
        } else if (/^[A-Z]/.test(word)) {
          tokens.push({ kind: 'type', value: word });
        } else {
          tokens.push({ kind: 'plain', value: word });
        }
        continue;
      }
    }

    // Single character (operator or plain)
    const isOp = /[+\-*/%=<>!&|^~?:;,.]/.test(ch);
    tokens.push({ kind: isOp ? 'operator' : 'plain', value: ch });
    i++;
  }

  return tokens;
}

function colorToken(token: Token, t: Theme): string {
  switch (token.kind) {
    case 'comment':  return chalk.hex(t.syntaxComment)(token.value);
    case 'string':   return chalk.hex(t.syntaxString)(token.value);
    case 'keyword':  return chalk.hex(t.syntaxKeyword).bold(token.value);
    case 'number':   return chalk.hex(t.syntaxNumber)(token.value);
    case 'function': return chalk.hex(t.syntaxFunction)(token.value);
    case 'type':     return chalk.hex(t.syntaxType)(token.value);
    case 'operator': return chalk.hex(t.syntaxOperator)(token.value);
    default:         return token.value;
  }
}

function highlightCode(line: string, lang: string, t: Theme): string {
  if (!lang || lang === 'text' || lang === 'txt') return line;
  const tokens = tokenizeLine(line, lang);
  return tokens.map((tok) => colorToken(tok, t)).join('');
}

// ─── Block parsing ───────────────────────────────────────────────────────────

interface TextBlock { kind: 'text'; lines: string[] }
interface CodeBlock { kind: 'code'; lang: string; lines: string[] }
type Block = TextBlock | CodeBlock;

function parseBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  const raw = content.split('\n');
  let inCode = false;
  let codeLang = '';
  let current: Block = { kind: 'text', lines: [] };

  for (const line of raw) {
    const fence = line.match(/^```(\w*)$/);
    if (fence && !inCode) {
      if (current.lines.length > 0) blocks.push(current);
      codeLang = fence[1] ?? '';
      current = { kind: 'code', lang: codeLang, lines: [] };
      inCode = true;
    } else if (/^```/.test(line) && inCode) {
      blocks.push(current);
      current = { kind: 'text', lines: [] };
      inCode = false;
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.length > 0 || blocks.length === 0) blocks.push(current);
  return blocks;
}

// ─── Inline text formatting ──────────────────────────────────────────────────

function renderInline(text: string, t: Theme): string {
  let out = text;

  // Inline code `...`
  out = out.replace(/`([^`]+)`/g, (_, code) =>
    chalk.hex(t.markdownCode)(code)
  );

  // Bold **...**
  out = out.replace(/\*\*(.+?)\*\*/g, (_, inner) => chalk.bold(inner));

  // Italic *...* or _..._
  out = out.replace(/\*(.+?)\*/g, (_, inner) => chalk.italic(inner));
  out = out.replace(/_([^_]+)_/g, (_, inner) => chalk.italic(inner));

  // Links [text](url)
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, linkText, url) =>
    chalk.hex(t.markdownLink).underline(linkText) + chalk.hex(t.textMuted)(' (' + url + ')')
  );

  // Strikethrough ~~...~~
  out = out.replace(/~~(.+?)~~/g, (_, inner) => chalk.strikethrough.hex(t.textMuted)(inner));

  return out;
}

// ─── Line rendering ──────────────────────────────────────────────────────────

function renderTextLine(line: string, t: Theme): string {
  // Empty line
  if (line.trim() === '') return '';

  // Heading
  const h = line.match(/^(#{1,6})\s+(.*)/);
  if (h) {
    const level = h[1].length;
    const text = renderInline(h[2], t);
    const styled = chalk.hex(t.markdownHeading).bold(text);
    return level === 1 ? styled + '\n' + chalk.hex(t.borderNormal)(Icons.separator.repeat(40)) : styled;
  }

  // Horizontal rule
  if (/^[-*_]{3,}$/.test(line.trim())) {
    return chalk.hex(t.borderNormal)(Icons.separator.repeat(50));
  }

  // Blockquote
  if (line.startsWith('> ')) {
    return chalk.hex(t.markdownBlockquote)(Icons.thickBorder + ' ' + renderInline(line.slice(2), t));
  }

  // Unordered list
  const ul = line.match(/^(\s*)[-*+]\s+(.*)/);
  if (ul) {
    return ul[1] + chalk.hex(t.primary)(Icons.bullet) + ' ' + renderInline(ul[2], t);
  }

  // Ordered list
  const ol = line.match(/^(\s*)(\d+)\.\s+(.*)/);
  if (ol) {
    return ol[1] + chalk.hex(t.primary)(ol[2] + '.') + ' ' + renderInline(ol[3], t);
  }

  return renderInline(line, t);
}

// ─── Public renderer ─────────────────────────────────────────────────────────

/**
 * Render markdown to an array of ANSI-colored lines.
 * Each entry is one display line (may contain ANSI codes).
 */
export function renderMarkdown(content: string, maxWidth: number, t: Theme): string[] {
  const blocks = parseBlocks(content);
  const out: string[] = [];
  const width = Math.max(20, maxWidth);

  for (const block of blocks) {
    if (block.kind === 'code') {
      const lang = block.lang || 'text';
      // Header bar
      const headerLabel = lang ? ` ${lang} ` : '';
      const headerBar = chalk.hex(t.borderNormal)(
        '─'.repeat(2) + headerLabel + '─'.repeat(Math.max(0, width - 4 - headerLabel.length))
      );
      out.push(headerBar);
      // Highlighted lines
      for (const line of block.lines) {
        out.push(highlightCode(line, lang, t));
      }
      // Footer bar
      out.push(chalk.hex(t.borderNormal)('─'.repeat(width - 2)));
    } else {
      for (const line of block.lines) {
        out.push(renderTextLine(line, t));
      }
    }
  }

  return out;
}

/** Count how many display lines the rendered markdown will occupy. */
export function countMarkdownLines(content: string, maxWidth: number, t: Theme): number {
  return renderMarkdown(content, maxWidth, t).length;
}
