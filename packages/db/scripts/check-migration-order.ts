// CI check on a pull request's migrations, against the base branch:
// - every migration it adds is newer than every migration on main, because Drizzle 0.x silently
//   skips a migration older than the newest one already applied (ADR 0021);
// - it doesn't remove, re-date or edit a migration main already has, because databases that ran
//   it would never see the change (or, if re-dated, would run it twice).
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

/** Tags of migrations in `base` that `head` removes or gives a different timestamp. */
export function findChangedMigrations(
  base: readonly JournalEntry[],
  head: readonly JournalEntry[],
): string[] {
  const headWhen = new Map(head.map((entry) => [entry.tag, entry.when]));
  return base.filter((entry) => headWhen.get(entry.tag) !== entry.when).map((entry) => entry.tag);
}

const migrationsPath = 'packages/db/migrations';
const journalPath = `${migrationsPath}/meta/_journal.json`;
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' });

function parseJournal(json: string): JournalEntry[] {
  return (JSON.parse(json) as { entries: JournalEntry[] }).entries;
}

function fail(lines: string[]): never {
  for (const line of lines) console.error(line);
  process.exit(1);
}

if (import.meta.main) {
  const baseRef = process.argv[2];
  if (baseRef === undefined) {
    console.error('Usage: node packages/db/scripts/check-migration-order.ts <base-ref>');
    process.exit(2);
  }
  // A wrong ref is a broken workflow, not "no migrations".
  let mergeBase: string;
  try {
    mergeBase = git('merge-base', baseRef, 'HEAD').trim();
  } catch {
    console.error(`Unknown git ref ${baseRef}. In CI, check out with fetch-depth: 0.`);
    process.exit(2);
  }
  // No journal on the base branch means no migrations yet. Any other failure (a journal that
  // isn't valid JSON) throws: a check that can't read its input must not pass.
  const baseHasJournal = git('ls-tree', '--name-only', baseRef, '--', journalPath).trim() !== '';
  const base = baseHasJournal ? parseJournal(git('show', `${baseRef}:${journalPath}`)) : [];
  const head = parseJournal(readFileSync(join(repoRoot, journalPath), 'utf8'));
  // Compared with the working tree, so a local run sees uncommitted edits too.
  const editedSql = git(
    'diff',
    '--name-only',
    '--no-renames',
    '--diff-filter=DM',
    mergeBase,
    '--',
    `${migrationsPath}/*.sql`,
  ).trim();

  const changed = findChangedMigrations(base, head);
  if (changed.length > 0 || editedSql !== '') {
    fail([
      ...changed.map(
        (tag) => `${tag} is on ${baseRef}, and this branch removes it or changes its timestamp.`,
      ),
      ...editedSql
        .split('\n')
        .filter(Boolean)
        .map((file) => `${file} is on ${baseRef}, and this branch edits or deletes it.`),
      "A migration that has run can't change: databases that ran it would never see the change.",
      'Undo the change and add a new migration instead (pnpm db:generate).',
    ]);
  }
  const outOfOrder = findOutOfOrderMigrations(base, head);
  if (outOfOrder.length > 0) {
    fail([
      ...outOfOrder.map(
        (tag) => `${tag} is older than the newest migration on ${baseRef}; Drizzle would skip it.`,
      ),
      'Rebase on main, delete your migration (the .sql file and its journal and snapshot entries) ' +
        'and run pnpm db:generate again (docs/devops/git-workflow.md).',
    ]);
  }
  console.log('Migrations OK');
}
