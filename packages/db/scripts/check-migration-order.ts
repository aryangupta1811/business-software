// CI check: every migration a pull request adds must be newer than every migration on main.
// Drizzle 0.x silently skips a migration older than the newest one already applied (ADR 0021).
// Run with plain Node (type stripping, no build): node packages/db/scripts/check-migration-order.ts origin/main
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface JournalEntry {
  tag: string;
  when: number;
}

/** Tags of migrations in `head` but not in `base` that Drizzle would skip after `base` ran. */
export function findOutOfOrderMigrations(
  base: readonly JournalEntry[],
  head: readonly JournalEntry[],
): string[] {
  const baseTags = new Set(base.map((entry) => entry.tag));
  const newestOnBase = Math.max(-Infinity, ...base.map((entry) => entry.when));
  return head
    .filter((entry) => !baseTags.has(entry.tag) && entry.when <= newestOnBase)
    .map((entry) => entry.tag);
}

const journalPath = 'packages/db/migrations/meta/_journal.json';
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

function parseJournal(json: string): JournalEntry[] {
  return (JSON.parse(json) as { entries: JournalEntry[] }).entries;
}

function readBaseJournal(baseRef: string): JournalEntry[] {
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' });
  // A wrong ref is a broken workflow, not "no migrations".
  try {
    git('rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`);
  } catch {
    console.error(`Unknown git ref ${baseRef}. In CI, check out with fetch-depth: 0.`);
    process.exit(2);
  }
  try {
    return parseJournal(git('show', `${baseRef}:${journalPath}`));
  } catch {
    return []; // The base branch has no migrations yet.
  }
}

if (import.meta.main) {
  const baseRef = process.argv[2];
  if (baseRef === undefined) {
    console.error('Usage: node packages/db/scripts/check-migration-order.ts <base-ref>');
    process.exit(2);
  }
  const head = parseJournal(readFileSync(join(repoRoot, journalPath), 'utf8'));
  const outOfOrder = findOutOfOrderMigrations(readBaseJournal(baseRef), head);
  if (outOfOrder.length === 0) {
    console.log('Migration order OK');
  } else {
    for (const tag of outOfOrder) {
      console.error(
        `${tag} is older than the newest migration on ${baseRef}; Drizzle would skip it.`,
      );
    }
    console.error(
      'Rebase on main, delete your migration (the .sql file and its journal and snapshot entries) ' +
        'and run pnpm db:generate again (docs/devops/git-workflow.md).',
    );
    process.exit(1);
  }
}
