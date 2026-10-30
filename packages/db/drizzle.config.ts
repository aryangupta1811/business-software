import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit runs from this package's folder. Variables already set (as in CI) win.
if (existsSync('../../.env')) {
  process.loadEnvFile('../../.env');
}

// Migrations must run as the owner role, so there is no fallback to any other URL.
const url = process.env.MIGRATION_DATABASE_URL;
if (!url) {
  throw new Error('MIGRATION_DATABASE_URL is not set: copy .env.example to .env');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
