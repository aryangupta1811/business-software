// Making and replacing the demo shop (ADR 0016's 2026-11-24 note, decision D5, option A). A reset
// never deletes: it builds a new demo business through the seed, then archives the older ones, so
// the demo buttons open the newest. At most weekly, so the worker asks "is the demo older than
// seven days?" each time it starts, and `pnpm seed:demo --force` does it by hand.
import { createDatabase } from '@business-software/db';
import { archiveOtherDemoBusinesses, findDemoBusiness } from './registry.js';
import { seedDemoShop, type SeedResult } from './seed.js';

const DAY = 24 * 60 * 60_000;

/** A demo shop is replaced when it is older than this. */
export const DEMO_MAX_AGE_DAYS = 7;

export interface EnsureOptions {
  /** The runtime database login (`DATABASE_URL`). */
  databaseUrl: string;
  /** Build a new one even if the current demo is young. */
  force?: boolean;
  /** The real time; tests pass their own. */
  now?: Date;
  days?: number;
  seed?: number;
  log?: (line: string) => void;
}

export type EnsureResult =
  | { action: 'kept'; businessId: string; ageDays: number }
  | { action: 'created'; archived: number; result: SeedResult };

/**
 * Keeps one fresh demo shop: nothing to do while the newest is under a week old, otherwise a new
 * one is built and the older ones are archived. Safe to run again at once: the second run finds
 * the new demo and keeps it.
 */
export async function ensureDemoShop(options: EnsureOptions): Promise<EnsureResult> {
  const now = options.now ?? new Date();
  const log = options.log ?? (() => undefined);
  const database = createDatabase(options.databaseUrl, (error) => {
    log(`Database pool error: ${error.message}`);
  });
  try {
    const current = await findDemoBusiness(database);
    if (current !== undefined && options.force !== true) {
      const ageDays = (now.getTime() - current.createdAt.getTime()) / DAY;
      if (ageDays < DEMO_MAX_AGE_DAYS) {
        log(`The demo shop is ${ageDays.toFixed(1)} days old: kept`);
        return { action: 'kept', businessId: current.businessId, ageDays };
      }
    }
    const result = await seedDemoShop({
      databaseUrl: options.databaseUrl,
      now,
      ...(options.days !== undefined && { days: options.days }),
      ...(options.seed !== undefined && { seed: options.seed }),
      log,
    });
    const archived = await archiveOtherDemoBusinesses(database, result.businessId);
    log(`New demo shop ${result.businessId}; archived ${String(archived)} older`);
    return { action: 'created', archived, result };
  } finally {
    await database.close();
  }
}

/** Hostnames that mean "this computer" or the Compose database: never a real customer's data. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'db']);

/**
 * ADR 0016: the seed refuses unless the target is marked as a demo or local database. "Marked"
 * is `DEMO_ENABLED=true` in the environment (the demo server sets it); "local" is this
 * computer's or the Compose database's hostname. Throws a message that never shows the URL,
 * which holds a password.
 */
export function assertSeedAllowed(env: NodeJS.ProcessEnv): void {
  if (env.DEMO_ENABLED === 'true') return;
  const url = env.DATABASE_URL;
  if (url !== undefined && URL.canParse(url) && LOCAL_HOSTS.has(new URL(url).hostname)) return;
  throw new Error(
    'Refusing to seed: this is neither a local database nor one marked as the demo (DEMO_ENABLED=true)',
  );
}
