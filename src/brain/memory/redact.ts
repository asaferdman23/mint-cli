/**
 * Secret denylist — regex-based redaction.
 *
 * Used by:
 *   - `extract.ts` to drop any extracted memory whose text contains a secret.
 *   - `store.ts` to reject writes that contain secrets.
 *
 * The aim is **conservative**: false positives (over-redacting a base64 string
 * that happens to look like a key) are acceptable. False negatives (a real
 * `sk-ant-*` slipping through into `<cwd>/.mint/memory.sqlite`) are not.
 *
 * Patterns are kept simple and well-anchored. Each entry has a kind label that
 * appears in the replacement marker `[REDACTED:<kind>]` so we can debug.
 */

interface SecretPattern {
  kind: string;
  /** Must be GLOBAL (and may be MULTILINE) so `replaceAll`/`match` find every hit. */
  regex: RegExp;
}

// IMPORTANT: order matters only for the redact path (we apply them in sequence
// and the replacement marker hides earlier matches from later regexes). For
// `containsSecret` we short-circuit on the first hit.
const PATTERNS: SecretPattern[] = [
  // Anthropic API key
  { kind: 'anthropic', regex: /sk-ant-[a-zA-Z0-9_-]{20,}/g },
  // OpenAI API key (incl. project-scoped `sk-proj-...`)
  { kind: 'openai', regex: /sk-(?:proj-)?[a-zA-Z0-9_-]{20,}/g },
  // GitHub personal/oauth/server/user tokens
  { kind: 'github', regex: /gh[opsu]_[A-Za-z0-9]{36}/g },
  // AWS access key
  { kind: 'aws_access_key', regex: /AKIA[0-9A-Z]{16}/g },
  // AWS secret: 40-char base64-ish near "secret" / "aws_secret_access_key".
  // We require the literal context within ~64 chars to keep false positives down.
  {
    kind: 'aws_secret',
    regex: /(?:secret|aws_secret_access_key)[^A-Za-z0-9]{0,8}[A-Za-z0-9/+=]{40}/gi,
  },
  // Slack tokens
  { kind: 'slack', regex: /xox[abprs]-[A-Za-z0-9-]{20,}/g },
  // JWT (three b64url segments)
  {
    kind: 'jwt',
    regex: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  },
  // Generic `.env`-style line: SOMETHING_(KEY|TOKEN|SECRET|PASSWORD|PASS)=value
  {
    kind: 'env_assignment',
    regex: /^[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASS)=.{8,}$/gm,
  },
  // Postgres URL with embedded credentials
  { kind: 'postgres_url', regex: /postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/g },
];

export interface RedactResult {
  redacted: string;
  hits: string[];
}

/**
 * Replace every match in `text` with `[REDACTED:<kind>]`. Returns the redacted
 * string and the list of kinds that fired (one entry per match, with dupes).
 */
export function redactSecrets(text: string): RedactResult {
  if (!text) return { redacted: text, hits: [] };
  let out = text;
  const hits: string[] = [];
  for (const { kind, regex } of PATTERNS) {
    // Fresh regex each call: global state on shared regex literals is a
    // common footgun across `exec`/`test`/`replace`.
    const re = new RegExp(regex.source, regex.flags);
    out = out.replace(re, () => {
      hits.push(kind);
      return `[REDACTED:${kind}]`;
    });
  }
  return { redacted: out, hits };
}

/** Fast boolean check — short-circuits on the first matching pattern. */
export function containsSecret(text: string): boolean {
  if (!text) return false;
  for (const { regex } of PATTERNS) {
    const re = new RegExp(regex.source, regex.flags);
    if (re.test(text)) return true;
  }
  return false;
}

/** Exposed for tests. */
export const __testing = { PATTERNS };
