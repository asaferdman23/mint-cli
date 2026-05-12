import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'src/brain/__tests__/**/*.test.ts',
      'src/providers/__tests__/**/*.test.ts',
      'src/cli/__tests__/**/*.test.ts',
      'src/usage/__tests__/**/*.test.ts',
    ],
    testTimeout: 10_000,
    clearMocks: true,
    // Disable file-level parallelism: several test files (record-replay,
    // tune) chdir into temp directories, which races with brain/loop tests
    // that read from process.cwd(). Process-level isolation is cheap here
    // (~70 tests, sub-15s sequential) and removes a class of flakes.
    fileParallelism: false,
  },
});
