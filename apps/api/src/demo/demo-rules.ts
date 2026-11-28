// What a visitor may not do in the public demo shop (ADR 0016's 2026-11-24 note, decision D5).
// The demo is one shared business that anyone can log into with a click, so the services refuse
// whatever could lock the next visitor out, change what the shop is, or reach a real inbox. The
// flag is the business's own `demo` column, read inside the same transaction as the work.
import { ForbiddenException } from '@nestjs/common';
import { businesses, type Database, type Transaction } from '@business-software/db';
import { inBusiness } from '../items/conflicts.js';
import type { Caller } from '../http/session.js';

/** The answer's code; the web app shows its own words for it. */
export const DEMO_REFUSED = 'demo_refused';

/** Whether the transaction's business is the demo shop. */
export async function isDemo(tx: Transaction): Promise<boolean> {
  const [row] = await tx.select({ demo: businesses.demo }).from(businesses);
  return row?.demo === true;
}

/** `403 demo_refused` in the demo shop; nothing anywhere else. */
export async function refuseInDemo(tx: Transaction): Promise<void> {
  if (await isDemo(tx)) throw new ForbiddenException({ code: DEMO_REFUSED });
}

/** The same check for a service that hasn't opened its transaction yet. */
export function refuseDemoFor(database: Database, caller: Caller): Promise<void> {
  return inBusiness(database, caller, refuseInDemo);
}
