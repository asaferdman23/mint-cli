// Cross-platform launcher for the replay test suite.
// Sets MINT_REPLAY=test/fixtures/recordings then runs vitest.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const env = {
  ...process.env,
  MINT_REPLAY: process.env.MINT_REPLAY ?? 'test/fixtures/recordings',
};

const npmBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const child = spawn(npmBin, ['vitest', 'run'], {
  cwd: repoRoot,
  env,
  stdio: 'inherit',
  shell: false,
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
