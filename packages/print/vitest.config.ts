import { defineConfig } from 'vitest/config';

export default defineConfig({
  ssr: {
    resolve: {
      // Vite's default server conditions, plus 'source': `@business-software/shared` is tested
      // from its TypeScript files, so no build is needed first (ADR 0020).
      conditions: ['source', 'module', 'node', 'development|production'],
    },
  },
});
