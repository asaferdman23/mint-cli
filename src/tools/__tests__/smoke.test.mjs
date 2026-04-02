/**
 * Smoke test for the modular tool system.
 * Bundles the TS tool registry with esbuild, then exercises the tools in a temp workspace.
 */

import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const tempBundleDir = mkdtempSync(path.join(tmpdir(), 'mint-tools-bundle-'));
  const bundlePath = path.join(tempBundleDir, 'tools-bundle.mjs');

  await build({
    entryPoints: [path.join(root, 'src/tools/index.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    outfile: bundlePath,
    logLevel: 'silent',
  });

  const { getAllTools, getToolDefinitions, executeTool } = await import(pathToFileURL(bundlePath).href);

  const repoCtx = { cwd: root, projectRoot: root };
  const tempWorkspace = mkdtempSync(path.join(tmpdir(), 'mint-tools-workspace-'));
  const tmpCtx = { cwd: tempWorkspace, projectRoot: tempWorkspace };

  mkdirSync(path.join(tempWorkspace, 'src'), { recursive: true });
  writeFileSync(path.join(tempWorkspace, 'sample.txt'), 'alpha\nmiddle\nalpha\n', 'utf8');
  writeFileSync(path.join(tempWorkspace, 'package.json'), JSON.stringify({ name: 'tmp-project', scripts: { test: 'node -e "console.log(\'Tests: 1 passed, 0 failed\')"' } }), 'utf8');

  let passed = 0;
  let failed = 0;

  function assert(name, condition) {
    if (condition) {
      console.log(`  ✓ ${name}`);
      passed++;
    } else {
      console.log(`  ✗ ${name}`);
      failed++;
    }
  }

  try {
    const tools = getAllTools();
    const toolNames = tools.map((tool) => tool.name).sort();
    assert('11 tools registered', tools.length === 11);
    assert(
      'tool names include new tools',
      ['bash', 'edit_file', 'find_files', 'git_diff', 'grep_files', 'list_dir', 'read_file', 'run_tests', 'search_replace', 'web_fetch', 'write_file']
        .every((name) => toolNames.includes(name))
    );

    const defs = getToolDefinitions();
    assert('11 definitions', defs.length === 11);
    assert('definitions have schemas', defs.every((def) => def.input_schema.type === 'object'));
    assert('search_replace schema marks path required', defs.find((def) => def.name === 'search_replace')?.input_schema.required?.includes('path') === true);
    assert('web_fetch schema marks url required', defs.find((def) => def.name === 'web_fetch')?.input_schema.required?.includes('url') === true);

    const readResult = await executeTool('read_file', { path: 'package.json' }, repoCtx);
    assert('read_file succeeds', readResult.success);
    assert('read_file sees package name', readResult.output.includes('"usemint"'));

    const findResult = await executeTool('find_files', { pattern: 'src/tools/*.ts' }, repoCtx);
    assert('find_files succeeds', findResult.success);
    assert('find_files sees search-replace', findResult.output.includes('search-replace.ts'));

    const grepResult = await executeTool('grep_files', { pattern: 'export const.*Tool', glob: '*.ts', dir: 'src/tools' }, repoCtx);
    assert('grep_files succeeds', grepResult.success);

    const listDirResult = await executeTool('list_dir', { depth: 1 }, repoCtx);
    assert('list_dir succeeds', listDirResult.success);
    assert('list_dir shows src/', listDirResult.output.includes('src/'));

    const bashResult = await executeTool('bash', { command: 'echo hello' }, repoCtx);
    assert('bash succeeds', bashResult.success);
    assert('bash output correct', bashResult.output.trim() === 'hello');

    const searchReplaceResult = await executeTool(
      'search_replace',
      { path: 'sample.txt', search: 'alpha', replace: 'beta', all: true },
      tmpCtx,
    );
    assert('search_replace succeeds', searchReplaceResult.success);
    assert('search_replace reports replacements', searchReplaceResult.output.includes('Replaced 2 occurrence(s)'));
    assert('search_replace preview contains context diff', searchReplaceResult.output.includes('@@'));
    assert('search_replace wrote changes', readFileSync(path.join(tempWorkspace, 'sample.txt'), 'utf8').includes('beta'));

    const runTestsResult = await executeTool(
      'run_tests',
      { command: `node -e "console.log('test result: ok. 2 passed; 0 failed;')"`, timeout: 5_000 },
      tmpCtx,
    );
    assert('run_tests succeeds', runTestsResult.success);
    assert('run_tests reports passed count', runTestsResult.output.includes('Passed: 2'));

    const gitDiffResult = await executeTool('git_diff', {}, repoCtx);
    assert('git_diff succeeds', gitDiffResult.success);
    assert('git_diff includes status heading', gitDiffResult.output.includes('Status:'));

    const blockedFetch = await executeTool('web_fetch', { url: 'http://localhost:3000' }, repoCtx);
    assert('web_fetch blocks localhost', !blockedFetch.success);

    const badInput = await executeTool('search_replace', { path: 'sample.txt' }, tmpCtx);
    assert('schema validation rejects missing params', !badInput.success);

    const unknownResult = await executeTool('nonexistent', {}, repoCtx);
    assert('unknown tool rejected', !unknownResult.success);
  } finally {
    rmSync(tempBundleDir, { recursive: true, force: true });
    rmSync(tempWorkspace, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
