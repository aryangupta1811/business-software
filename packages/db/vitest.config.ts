import { defineConfig } from 'vitest/config';

export default defineConfig({
  ssr: {
    resolve: {
      // Vite's default server conditions, plus 'source': `@business-software/shared` is
      // tested from its TypeScript files, so no build is needed first (ADR 0020). Without it
      // the tests passed only on a machine that had built shared before (CI, 2026-11-19).
      conditions: ['source', 'module', 'node', 'development|production'],
    },
  },
  test: {
    testTimeout: 30_000,
    // The first run pulls the PostgreSQL image.
    hookTimeout: 180_000,
  },
});
