import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 30_000,
    // The first run pulls the PostgreSQL image.
    hookTimeout: 180_000,
  },
});
