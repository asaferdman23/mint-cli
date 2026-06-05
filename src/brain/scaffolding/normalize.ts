/**
 * Format normalization — Milestone 1 of old-model-scaffolding.
 *
 * Weak models (Llama 70B, Mistral Small, Gemini Flash, GPT-OSS-20B) routinely
 * emit tool-call inputs with predictable malformations: capitalized property
 * names, comma-separated strings where the schema expects arrays, boolean
 * strings, unnormalized paths.
 *
 * Today's behavior: the tool errors → the model burns a whole turn figuring
 * out what went wrong from the error message → maybe gets it right.
 *
 * After normalization: the harness silently fixes the dumb mistake → the tool
 * dispatches correctly → the turn is saved. Every fix is observable via
 * `warn` + `scaffolding.applied` events so it's never silent magic.
 *
 * **Slice 1 (this file): `normalizeKeyCase` only.** Other rules
 * (`splitCommaToArray`, `coerceBooleanStrings`, `normalizePathStrings`) ship
 * in subsequent slices once this one's observability is shaken out.
 */
import type { ToolDefinition } from '../../tools/types.js';

export interface NormalizationDiff {
  /** Stable rule identifier — surfaced in the `scaffolding.applied` event
   *  so `mint audit` can break down by rule. */
  rule: 'key_case';
  /** Human-readable summary suitable for a `warn` event. */
  message: string;
}

export interface NormalizeResult {
  input: Record<string, unknown>;
  normalizations: NormalizationDiff[];
}

/**
 * Best-effort coercion of common weak-model tool-input malformations. Pure;
 * never throws. Returns the (possibly rewritten) input plus the list of
 * normalizations that fired — the caller is responsible for emitting events.
 */
export function normalizeToolInput(
  input: Record<string, unknown>,
  schema: ToolDefinition['input_schema'],
): NormalizeResult {
  const normalizations: NormalizationDiff[] = [];
  const next = normalizeKeyCase(input, schema, normalizations);
  return { input: next, normalizations };
}

/**
 * Map property names that differ from the schema only by case to the schema's
 * canonical casing. Example: `{Path: "x.ts"}` against a schema expecting
 * `{path: ...}` becomes `{path: "x.ts"}`.
 *
 * Only fires when the case-insensitive match is unambiguous — if both `path`
 * and `Path` somehow existed in the schema we'd leave it alone.
 */
function normalizeKeyCase(
  input: Record<string, unknown>,
  schema: ToolDefinition['input_schema'],
  diffs: NormalizationDiff[],
): Record<string, unknown> {
  const props = schema.properties ?? {};
  const schemaKeys = Object.keys(props);
  if (schemaKeys.length === 0) return input;

  // Build a case-insensitive lookup of schema property names. If two schema
  // keys collide under lowercasing (unlikely but possible), mark the bucket
  // as ambiguous so we never auto-rewrite to one of them.
  const lookup = new Map<string, string | null>();
  for (const k of schemaKeys) {
    const lower = k.toLowerCase();
    lookup.set(lower, lookup.has(lower) ? null : k);
  }

  const out: Record<string, unknown> = {};
  let changed = false;
  for (const [key, value] of Object.entries(input)) {
    if (key in props) {
      out[key] = value;
      continue;
    }
    const canonical = lookup.get(key.toLowerCase());
    if (canonical && canonical !== key && !(canonical in input)) {
      out[canonical] = value;
      diffs.push({
        rule: 'key_case',
        message: `normalized tool input key ${key} → ${canonical}`,
      });
      changed = true;
    } else {
      out[key] = value;
    }
  }
  return changed ? out : input;
}
