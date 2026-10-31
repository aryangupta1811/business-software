import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    // Before react(): it writes src/routeTree.gen.ts from src/routes/ and splits each page
    // into its own file.
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // The browser calls /api on the page's own address, like it will through Caddy, so
    // session cookies work and there's no CORS (ADR 0011).
    proxy: { '/api': 'http://127.0.0.1:3000' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    // Undo vi.stubGlobal (the tests' fake fetch) and vi.spyOn after each test.
    unstubGlobals: true,
    restoreMocks: true,
  },
});
