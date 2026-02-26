import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
  },
  {
    entry: ['src/cli.ts', 'src/mcp.ts', 'src/analyze.ts'],
    format: ['esm'],
    banner: { js: '#!/usr/bin/env node' },
  },
]);
