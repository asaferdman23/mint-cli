import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'src/brain/__tests__/**/*.test.ts',
      'src/providers/__tests__/**/*.test.ts',
    ],
    testTimeout: 10_000,
    clearMocks: true,
  },
});
