// src/tui/hooks/__tests__/useSlashCommands.test.ts
// Tests for the pure `parseSlashCommand` helper. The full hook is integration-
// tested via BrainApp; the parser is the only piece we can unit-test cheaply
// without a full Ink render.
import { describe, it, expect } from 'vitest';
import { parseSlashCommand } from '../useSlashCommands.js';

describe('parseSlashCommand', () => {
  it('returns null for non-slash input', () => {
    expect(parseSlashCommand('hello')).toBeNull();
    expect(parseSlashCommand('')).toBeNull();
    expect(parseSlashCommand('   ')).toBeNull();
  });

  it('returns null for a bare slash', () => {
    expect(parseSlashCommand('/')).toBeNull();
  });

  it('parses a no-argument command', () => {
    expect(parseSlashCommand('/help')).toEqual({ name: 'help', args: [] });
    expect(parseSlashCommand('/clear')).toEqual({ name: 'clear', args: [] });
  });

  it('parses arguments separated by whitespace', () => {
    expect(parseSlashCommand('/model deepseek-v3.2')).toEqual({
      name: 'model',
      args: ['deepseek-v3.2'],
    });
    expect(parseSlashCommand('/model   auto')).toEqual({
      name: 'model',
      args: ['auto'],
    });
  });

  it('trims surrounding whitespace before parsing', () => {
    expect(parseSlashCommand('  /trace  ')).toEqual({ name: 'trace', args: [] });
  });

  it('preserves multi-token arguments', () => {
    expect(parseSlashCommand('/foo a b c')).toEqual({
      name: 'foo',
      args: ['a', 'b', 'c'],
    });
  });

  it('parses /remember with a multi-token preference', () => {
    // Note: parseSlashCommand splits on whitespace; the handler reconstructs
    // the full text with `trimmed.slice('/remember'.length).trim()`. The
    // parser-level shape is just the tokenised args.
    expect(parseSlashCommand('/remember vitest > jest')).toEqual({
      name: 'remember',
      args: ['vitest', '>', 'jest'],
    });
  });

  it('parses /memory list with a subcommand arg', () => {
    expect(parseSlashCommand('/memory list facts')).toEqual({
      name: 'memory',
      args: ['list', 'facts'],
    });
  });

  it('parses /memory clear --confirm', () => {
    expect(parseSlashCommand('/memory clear --confirm')).toEqual({
      name: 'memory',
      args: ['clear', '--confirm'],
    });
  });

  it('parses /forget <id>', () => {
    expect(parseSlashCommand('/forget 7')).toEqual({
      name: 'forget',
      args: ['7'],
    });
  });
});
