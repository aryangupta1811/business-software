import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  and,
  asc,
  customers,
  eq,
  isNull,
  recordEntry,
  sql,
  type Database,
  type Transaction,
} from '@business-software/db';
import {
  DEFAULT_DUE_DAYS,
  type CustomerInput,
  type CustomerQuery,
  type CustomerUpdateInput,
  type CustomerView,
} from '@business-software/shared';
import { DATABASE } from '../database.module.js';
import { changes, inBusiness } from '../items/conflicts.js';
import type { Caller } from '../http/session.js';

type CustomerRecord = typeof customers.$inferSelect;

/** At most this many answers to a search; the counter shows a short list. */
const SEARCH_LIMIT = 20;

function toView(row: CustomerRecord): CustomerView {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    gstin: row.gstin,
    legalName: row.legalName,
    address: row.address,
    pinCode: row.pinCode,
    stateCode: row.stateCode,
    creditLimitPaise: row.creditLimitPaise,
    dueDays: row.dueDays,
    version: row.version,
  };
}

/** What the log records of a customer: everything but its id and version. */
function logged(view: CustomerView): Record<string, unknown> {
  const fields: Record<string, unknown> = { ...view };
  delete fields.id;
  delete fields.version;
  return fields;
}

/**
 * `03` #24: the credit limit and the due days are the owner's. Staff see them and may send them
 * back as they are (the form does), but changing them, or setting them on a new customer, is
 * refused. Left out means unchanged (or the defaults for a new customer).
 */
function creditTerms(
  caller: Caller,
  input: CustomerInput,
  current: { creditLimitPaise: number | null; dueDays: number },
) {
  const terms = {
    creditLimitPaise:
      input.creditLimitPaise === undefined ? current.creditLimitPaise : input.creditLimitPaise,
    dueDays: input.dueDays ?? current.dueDays,
  };
  const changed =
    terms.creditLimitPaise !== current.creditLimitPaise || terms.dueDays !== current.dueDays;
  if (changed && caller.role !== 'owner') {
    throw new ForbiddenException({ code: 'credit_terms_owner_only' });
  }
  return terms;
}

/** The columns a customer form sets. */
function columns(input: CustomerInput) {
  return {
    name: input.name,
    phone: input.phone,
    gstin: input.gstin,
    legalName: input.legalName,
    address: input.address,
    pinCode: input.pinCode,
    stateCode: input.stateCode,
  };
}

/** `%`, `_` and `\` typed in a search are letters, not LIKE wildcards. */
export const likeText = (text: string) => `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

/** Customers at the billing counter (P1.13 design §7, §14). Archived, never deleted. */
@Injectable()
export class CustomersService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /** `F3` at the counter: a phone finds that customer; text finds names, phones and GSTINs. */
  find(caller: Caller, query: CustomerQuery): Promise<CustomerView[]> {
    return inBusiness(this.database, caller, async (tx) => {
      const matches =
        query.phone !== undefined
          ? eq(customers.phone, query.phone)
          : sql`(${customers.name} ilike ${likeText(query.q ?? '')}
                or ${customers.phone} like ${likeText(query.q ?? '')}
                or ${customers.gstin} ilike ${likeText(query.q ?? '')})`;
      const rows = await tx
        .select()
        .from(customers)
        .where(and(isNull(customers.archivedAt), matches))
        .orderBy(asc(customers.name), asc(customers.id))
        .limit(SEARCH_LIMIT);
      return rows.map(toView);
    });
  }

  create(caller: Caller, input: CustomerInput): Promise<CustomerView> {
    return inBusiness(this.database, caller, async (tx) => {
      const terms = creditTerms(caller, input, {
        creditLimitPaise: null,
        dueDays: DEFAULT_DUE_DAYS,
      });
      const [row] = await tx
        .insert(customers)
        .values({ ...columns(input), ...terms })
        .returning();
      if (row === undefined) throw new Error('No customer row returned');
      const view = toView(row);
      await recordEntry(tx, {
        actorId: caller.userId,
        action: 'customer.created',
        entityType: 'customer',
        entityId: view.id,
        after: logged(view),
      });
      return view;
    });
  }

  /** The whole customer, saved from the copy at `version`; someone else's newer save wins (409). */
  update(caller: Caller, id: string, input: CustomerUpdateInput): Promise<CustomerView> {
    return inBusiness(this.database, caller, async (tx) => {
      const current = await this.lock(tx, id);
      if (current.version !== input.version) throw new ConflictException({ code: 'stale' });
      const before = toView(current);
      const terms = creditTerms(caller, input, before);
      const columnsNow = { ...columns(input), ...terms };
      const changed = changes(logged(before), logged({ ...before, ...columnsNow }));
      if (changed === null) return before;
      const [row] = await tx
        .update(customers)
        .set({
          ...columnsNow,
          version: sql`${customers.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(customers.id, id))
        .returning();
      if (row === undefined) throw new Error('No customer row updated');
      await recordEntry(tx, {
        actorId: caller.userId,
        action: 'customer.updated',
        entityType: 'customer',
        entityId: id,
        ...changed,
      });
      return toView(row);
    });
  }

  /** A live customer of this business, locked for the save; else 404. */
  private async lock(tx: Transaction, id: string): Promise<CustomerRecord> {
    const [row] = await tx
      .select()
      .from(customers)
      .where(and(eq(customers.id, id), isNull(customers.archivedAt)))
      .for('update');
    if (row === undefined) throw new NotFoundException({ code: 'not_found' });
    return row;
  }
}
