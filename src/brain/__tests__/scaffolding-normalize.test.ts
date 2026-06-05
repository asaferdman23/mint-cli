import { describe, it, expect } from 'vitest';
import { normalizeToolInput } from '../scaffolding/normalize.js';
import type { ToolDefinition } from '../../tools/types.js';

const schema: ToolDefinition['input_schema'] = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    recursive: { type: 'boolean' },
  },
  required: ['path'],
};

describe('normalizeToolInput — key case (Milestone 1, slice 1)', () => {
  it('passes through input that already matches the schema', () => {
    const { input, normalizations } = normalizeToolInput(
      { path: 'src/a.ts', recursive: true },
      schema,
    );
    expect(input).toEqual({ path: 'src/a.ts', recursive: true });
    expect(normalizations).toHaveLength(0);
  });

  it('renames Path → path when the schema expects lowercase', () => {
    const { input, normalizations } = normalizeToolInput({ Path: 'src/a.ts' }, schema);
    expect(input).toEqual({ path: 'src/a.ts' });
    expect(normalizations).toHaveLength(1);
    expect(normalizations[0].rule).toBe('key_case');
    expect(normalizations[0].message).toContain('Path');
    expect(normalizations[0].message).toContain('path');
  });

  it('renames multiple wrong-cased keys in one call', () => {
    const { input, normalizations } = normalizeToolInput(
      { Path: 'a.ts', Recursive: false },
      schema,
    );
    expect(input).toEqual({ path: 'a.ts', recursive: false });
    expect(normalizations).toHaveLength(2);
  });

  it('does not overwrite a canonical key that is already present', () => {
    const { input, normalizations } = normalizeToolInput(
      { path: 'real.ts', Path: 'shadow.ts' },
      schema,
    );
    expect(input.path).toBe('real.ts');
    // Path is preserved as-is (no rewrite) so the validation layer can surface
    // it as an unknown property rather than silently overwriting `path`.
    expect(input.Path).toBe('shadow.ts');
    expect(normalizations).toHaveLength(0);
  });

  it('leaves unknown keys alone (only renames case-insensitive matches)', () => {
    const { input, normalizations } = normalizeToolInput(
      { totallyMadeUp: 1, Path: 'x.ts' },
      schema,
    );
    expect(input).toEqual({ totallyMadeUp: 1, path: 'x.ts' });
    expect(normalizations).toHaveLength(1);
  });

  it('is a no-op on a schema with no properties', () => {
    const { input, normalizations } = normalizeToolInput(
      { Anything: 'goes' },
      { type: 'object', properties: {} },
    );
    expect(input).toEqual({ Anything: 'goes' });
    expect(normalizations).toHaveLength(0);
  });
});
