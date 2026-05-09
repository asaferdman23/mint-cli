/**
 * BM25 search over ProjectIndex — in-memory, rebuilt on session open.
 *
 * Replaces src/context/search.ts's hardcoded keyword scorer. A document per
 * indexed file, tokenized from:
 *   - file path (split on / and _ -)
 *   - exported names + symbol names
 *   - summary text
 *
 * Classic BM25 with k1=1.5, b=0.75. Identifier-aware tokenization: snake_case
 * and CamelCase get split so "useAgentEvents" hits "agent" and "events".
 */
import type { ProjectIndex } from '../../context/indexer.js';

const K1 = 1.5;
const B = 0.75;

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has',
  'have', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the',
  'to', 'was', 'were', 'will', 'with', 'this', 'these', 'those', 'i',
  'you', 'we', 'they', 'my', 'your', 'our', 'their', 'me', 'do', 'does',
  'did', 'can', 'could', 'would', 'should', 'add', 'fix', 'update', 'make',
  'create', 'change', 'set', 'get', 'use', 'used', 'using',
]);

export interface BM25Document {
  path: string;
  tokens: string[];
  summary: string;
}

export interface BM25SearchResult {
  path: string;
  score: number;
  summary: string;
}

/**
 * Identifier-aware tokenizer.
 * "useAgentEvents" → ["useagentevents", "use", "agent", "events"]
 * "src/brain/loop.ts" → ["src", "brain", "loop", "ts"]
 */
export function tokenize(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  const lower = text.toLowerCase();

  // Split on anything non-alphanumeric.
  for (const raw of lower.split(/[^a-z0-9]+/)) {
    if (!raw) continue;
    if (STOP_WORDS.has(raw)) continue;
    if (raw.length < 2) continue;
    out.push(raw);
  }

  // Also emit sub-tokens from CamelCase/snake_case in the original text.
  for (const piece of text.split(/[^A-Za-z0-9]+/)) {
    if (!piece) continue;
    // Split CamelCase: "useAgentEvents" → ["use", "Agent", "Events"]
    const camels = piece.split(/(?=[A-Z])/);
    if (camels.length > 1) {
      for (const c of camels) {
        const t = c.toLowerCase();
        if (t.length >= 2 && !STOP_WORDS.has(t)) out.push(t);
      }
    }
  }
  return out;
}

function buildDocument(path: string, file: ProjectIndex['files'][string]): BM25Document {
  const parts: string[] = [path];
  for (const imp of file.imports) parts.push(imp);
  for (const exp of file.exports) parts.push(exp);
  for (const sym of file.symbols) {
    parts.push(sym.name);
    parts.push(sym.signature);
  }
  if (file.summary) parts.push(file.summary);
  return {
    path,
    tokens: tokenize(parts.join(' ')),
    summary: file.summary ?? '',
  };
}

export class BM25Index {
  readonly docs: BM25Document[];
  private readonly docLengths: number[];
  private readonly avgDocLength: number;
  private readonly docFreq: Map<string, number>;
  private readonly termFreqs: Array<Map<string, number>>;

  constructor(docs: BM25Document[]) {
    this.docs = docs;
    this.docLengths = docs.map((d) => d.tokens.length);
    const total = this.docLengths.reduce((s, n) => s + n, 0);
    this.avgDocLength = docs.length > 0 ? total / docs.length : 0;

    this.docFreq = new Map();
    this.termFreqs = docs.map((d) => {
      const tf = new Map<string, number>();
      for (const token of d.tokens) {
        tf.set(token, (tf.get(token) ?? 0) + 1);
      }
      // Increment doc frequency once per unique term
      for (const term of tf.keys()) {
        this.docFreq.set(term, (this.docFreq.get(term) ?? 0) + 1);
      }
      return tf;
    });
  }

  private idf(term: string): number {
    const df = this.docFreq.get(term) ?? 0;
    const n = this.docs.length;
    // BM25+ IDF clamp: max(0, log((N - df + 0.5) / (df + 0.5) + 1))
    return Math.log((n - df + 0.5) / (df + 0.5) + 1);
  }

  private scoreDoc(terms: string[], docIdx: number): number {
    const tf = this.termFreqs[docIdx];
    const len = this.docLengths[docIdx];
    if (!tf || len === 0) return 0;

    let score = 0;
    const norm = 1 - B + B * (len / (this.avgDocLength || 1));
    for (const term of terms) {
      const f = tf.get(term);
      if (!f) continue;
      const idf = this.idf(term);
      score += idf * ((f * (K1 + 1)) / (f + K1 * norm));
    }
    return score;
  }

  search(query: string, topN = 20): BM25SearchResult[] {
    const terms = tokenize(query);
    if (terms.length === 0) return [];

    const scored: BM25SearchResult[] = [];
    for (let i = 0; i < this.docs.length; i++) {
      const score = this.scoreDoc(terms, i);
      if (score > 0) {
        scored.push({ path: this.docs[i].path, score, summary: this.docs[i].summary });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topN);
  }
}

/** Build a BM25 index from a ProjectIndex. Cheap — tokenization dominates. */
export function buildBM25Index(index: ProjectIndex): BM25Index {
  const docs: BM25Document[] = [];
  for (const [path, file] of Object.entries(index.files)) {
    docs.push(buildDocument(path, file));
  }
  return new BM25Index(docs);
}
