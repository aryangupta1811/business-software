import { defineConfig } from 'vitest/config';

export default defineConfig({
  ssr: {
    resolve: {
      // 'source' first: workspace packages are tested from their TypeScript files, so no
      // build is needed first (ADR 0020). Then what Node itself uses. Vite's default adds
      // 'module', which picks the AWS SDK's dist-es build: Node can't load its extensionless
      // imports, so tests would load code the running API never does.
      conditions: ['source', 'node', 'development|production'],
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
