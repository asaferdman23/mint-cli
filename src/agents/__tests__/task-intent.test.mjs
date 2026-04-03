import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { strict as assert } from 'node:assert';

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const tempBundleDir = mkdtempSync(path.join(tmpdir(), 'mint-task-intent-'));
  const bundlePath = path.join(tempBundleDir, 'task-intent.mjs');

  try {
    await build({
      entryPoints: [path.join(root, 'src/agents/task-intent.ts')],
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node20',
      outfile: bundlePath,
      logLevel: 'silent',
    });

    const { inferBuilderTaskIntent } = await import(pathToFileURL(bundlePath).href);

    assert.equal(inferBuilderTaskIntent('review the landing page'), 'analysis');
    assert.equal(inferBuilderTaskIntent('scan the landing page and tell me what to improve'), 'analysis');
    assert.equal(inferBuilderTaskIntent('fix the landing page hero copy'), 'change');
    assert.equal(inferBuilderTaskIntent('add a new CTA button'), 'change');

    console.log('Task intent smoke passed.');
  } finally {
    rmSync(tempBundleDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
