import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { 'cli/index': 'src/cli/index.ts' },
  format: ['esm'],
  target: 'node20',
  clean: true,
  dts: false,
  splitting: false,
  sourcemap: true,
  jsx: 'react-jsx',
  banner: {
    js: '#!/usr/bin/env node',
  },
  define: {
    'process.env.MINT_GATEWAY_URL': JSON.stringify(process.env.MINT_GATEWAY_URL ?? 'https://api.usemint.dev'),
    'process.env.MINT_API_TOKEN':   JSON.stringify(process.env.MINT_API_TOKEN ?? ''),
  },
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
