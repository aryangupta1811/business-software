import { defineConfig } from 'vitest/config';

export default defineConfig({
  ssr: {
    resolve: {
      // Vite's default server conditions, plus 'source': workspace packages are tested
      // from their TypeScript files, so no build is needed first (ADR 0020).
      conditions: ['source', 'module', 'node', 'development|production'],
    },
  },
  test: {
    // Nest logs every app start; show logs only for failing tests.
    silent: 'passed-only',
    testTimeout: 30_000,
    // The first run pulls the PostgreSQL image.
    hookTimeout: 180_000,
  },
});
