import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { strict as assert } from 'node:assert';

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const tempBundleDir = mkdtempSync(path.join(tmpdir(), 'mint-conversation-gate-'));
  const bundlePath = path.join(tempBundleDir, 'conversation-gate.mjs');

  try {
    await build({
      entryPoints: [path.join(root, 'src/agents/conversation-gate.ts')],
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node20',
      outfile: bundlePath,
      logLevel: 'silent',
    });

    const { getConversationBypass } = await import(pathToFileURL(bundlePath).href);

    const greeting = getConversationBypass('hey');
    assert.ok(greeting, 'greeting should short-circuit');
    assert.equal(greeting.reason, 'greeting');
    assert.match(greeting.response, /inspect|change/i);

    const help = getConversationBypass('help');
    assert.ok(help, 'bare help should short-circuit');
    assert.equal(help.reason, 'help');

    const task = getConversationBypass('what can we change in the landing page?');
    assert.equal(task, null, 'real repo questions should not short-circuit');

    const actionable = getConversationBypass('fix auth bug');
    assert.equal(actionable, null, 'actionable tasks should not short-circuit');

    console.log('Conversation gate smoke passed.');
  } finally {
    rmSync(tempBundleDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
