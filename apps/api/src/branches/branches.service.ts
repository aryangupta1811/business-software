// Branches (P1.6 design, sections 5 and 7; Module 00 #12–#14, #54–#60; ADR 0045). Each change
// and its log entry commit together. The owner's password is checked by the session service
// (rate-limited per session) before anything is written.
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  and,
  asc,
  branches,
  businesses,
  devices,
  eq,
  isNull,
  recordEntry,
  sessions,
  sql,
  users,
  type Database,
  type Transaction,
} from '@business-software/db';
import type { BranchInput, BranchRef, BranchView } from '@business-software/shared';
import { CLOCK, type Clock } from '../auth/clock.js';
import { SESSION_SERVICE, type SessionService } from '../auth/session.service.js';
import { DATABASE } from '../database.module.js';
import type { Caller } from '../http/session.js';
import { changes, inBusiness } from '../items/conflicts.js';

type Fields = Record<'name' | 'code' | 'stateCode', string> &
  Record<'address' | 'pinCode' | 'gstin' | 'drugLicence' | 'fssai', string | null>;

/** The branch columns a log entry records, in the form's field names. */
function fieldsOf(branch: Fields): Fields {
  return {
    name: branch.name,
    code: branch.code,
    address: branch.address,
    pinCode: branch.pinCode,
    stateCode: branch.stateCode,
    gstin: branch.gstin,
    drugLicence: branch.drugLicence,
    fssai: branch.fssai,
  };
}

/** The oldest branch is the head office (`00` #36): it holds the business's details. */
const OLDEST_FIRST = [asc(branches.createdAt), asc(branches.id)] as const;

@Injectable()
export class BranchesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  list(caller: Caller, includeArchived: boolean): Promise<BranchView[]> {
    return inBusiness(this.database, caller, (tx) => this.viewsIn(tx, includeArchived));
  }

  /**
   * The short list for the branch picker: every active branch for the owner, and for staff
   * only the one they are logged in at (they never see the others' names).
   */
  picker(caller: Caller): Promise<BranchRef[]> {
    return inBusiness(this.database, caller, async (tx) => {
      const rows = await tx
        .select({ id: branches.id, code: branches.code, name: branches.name })
        .from(branches)
        .where(
          and(
            isNull(branches.archivedAt),
            caller.role === 'owner' ? undefined : eq(branches.id, caller.branchId),
          ),
        )
        .orderBy(...OLDEST_FIRST);
      return rows;
    });
  }

  create(caller: Caller, input: BranchInput): Promise<BranchView> {
    return inBusiness(this.database, caller, async (tx) => {
      await this.refuseGstinOutsideBusiness(tx, input);
      const [created] = await tx
        .insert(branches)
        .values({ businessId: caller.businessId, ...fieldsOf(input) })
        .returning({ id: branches.id });
      if (created === undefined) throw new Error('No branch row returned');
      await recordEntry(tx, {
        actorId: caller.userId,
        action: 'branch.created',
        entityType: 'branch',
        entityId: created.id,
        branchId: created.id,
        after: fieldsOf(input),
      });
      return this.viewIn(tx, created.id);
    });
  }

  /** The whole form; only the fields that changed are logged, and no change logs nothing. */
  update(caller: Caller, id: string, input: BranchInput): Promise<BranchView> {
    return inBusiness(this.database, caller, async (tx) => {
      const current = await this.lock(tx, id);
      await this.refuseGstinOutsideBusiness(tx, input);
      const changed = changes(fieldsOf(current), fieldsOf(input));
      if (changed === null) return this.viewIn(tx, id);
      await tx
        .update(branches)
        .set({ ...fieldsOf(input), updatedAt: this.clock.now() })
        .where(eq(branches.id, id));
      await recordEntry(tx, {
        actorId: caller.userId,
        action: 'branch.updated',
        entityType: 'branch',
        entityId: id,
        branchId: id,
        ...changed,
      });
      return this.viewIn(tx, id);
    });
  }

  /**
   * Closes a branch (owner answer 6A). Refused for the head office and while active staff call
   * it home. Its computers are forgotten and every session on them ends; stock and history stay.
   */
  async archive(caller: Caller, id: string, ownerPassword: string): Promise<BranchView> {
    await this.sessions.requireOwnerPassword(caller, ownerPassword);
    return inBusiness(this.database, caller, async (tx) => {
      const current = await this.lock(tx, id);
      if (current.archivedAt !== null) return this.viewIn(tx, id);
      const [head] = await tx
        .select({ id: branches.id })
        .from(branches)
        .orderBy(...OLDEST_FIRST)
        .limit(1);
      if (head?.id === id) throw new ConflictException({ code: 'head_office' });
      const [home] = await tx
        .select({ staff: sql<number>`count(*)::int` })
        .from(users)
        .where(
          and(eq(users.role, 'staff'), eq(users.homeBranchId, id), isNull(users.deactivatedAt)),
        );
      if (home !== undefined && home.staff > 0) {
        throw new ConflictException({ code: 'branch_in_use', staff: home.staff });
      }
      await tx.update(branches).set({ archivedAt: this.clock.now() }).where(eq(branches.id, id));
      const forgotten = await tx
        .update(devices)
        .set({ revokedAt: this.clock.now() })
        .where(and(eq(devices.branchId, id), isNull(devices.revokedAt)))
        .returning({ id: devices.id });
      await this.sessions.endSessionsIn(tx, eq(sessions.branchId, id), 'device_forgotten');
      for (const device of forgotten) {
        await recordEntry(tx, {
          actorId: caller.userId,
          action: 'device.revoked',
          entityType: 'device',
          entityId: device.id,
          branchId: id,
          after: { cause: 'branch_archived' },
        });
      }
      await recordEntry(tx, {
        actorId: caller.userId,
        action: 'branch.archived',
        entityType: 'branch',
        entityId: id,
        branchId: id,
      });
      return this.viewIn(tx, id);
    });
  }

  /** Brings a branch back. Its forgotten computers stay forgotten: the owner logs in there again. */
  restore(caller: Caller, id: string): Promise<BranchView> {
    return inBusiness(this.database, caller, async (tx) => {
      const current = await this.lock(tx, id);
      if (current.archivedAt === null) return this.viewIn(tx, id);
      await tx.update(branches).set({ archivedAt: null }).where(eq(branches.id, id));
      await recordEntry(tx, {
        actorId: caller.userId,
        action: 'branch.restored',
        entityType: 'branch',
        entityId: id,
        branchId: id,
      });
      return this.viewIn(tx, id);
    });
  }

  // ---------------------------------------------------------------------------------------

  /** The branch of this business, locked for a change; else 404. */
  private async lock(tx: Transaction, id: string) {
    const [row] = await tx.select().from(branches).where(eq(branches.id, id)).for('update');
    if (row === undefined) throw new NotFoundException({ code: 'not_found' });
    return row;
  }

  /**
   * The business-wide GST rules for a branch's GSTIN (the same as the business details card):
   * an unregistered business holds none, and it carries the business's PAN.
   */
  private async refuseGstinOutsideBusiness(tx: Transaction, input: BranchInput): Promise<void> {
    if (input.gstin === null) return;
    const [business] = await tx
      .select({ gstStatus: businesses.gstStatus, pan: businesses.pan })
      .from(businesses);
    if (business === undefined) throw new Error('Business not found');
    const problem =
      business.gstStatus === 'unregistered'
        ? 'not_registered'
        : business.pan !== null && input.gstin.slice(2, 12) !== business.pan
          ? 'pan_mismatch'
          : null;
    if (problem !== null) {
      throw new BadRequestException({ code: 'invalid_body', fields: { gstin: problem } });
    }
  }

  private async viewIn(tx: Transaction, id: string): Promise<BranchView> {
    const [view] = (await this.viewsIn(tx, true)).filter((branch) => branch.id === id);
    if (view === undefined) throw new NotFoundException({ code: 'not_found' });
    return view;
  }

  private async viewsIn(tx: Transaction, includeArchived: boolean): Promise<BranchView[]> {
    const rows = await tx
      .select({
        branch: branches,
        // Written out: Drizzle prints a single-table query's columns without their table, and
        // inside these subqueries `id` would mean the inner table's.
        computers: sql<number>`(select count(*)::int from devices d
          where d.branch_id = "branches"."id" and d.revoked_at is null)`,
        staff: sql<number>`(select count(*)::int from users u
          where u.home_branch_id = "branches"."id" and u.role = 'staff'
            and u.deactivated_at is null)`,
      })
      .from(branches)
      .where(includeArchived ? undefined : isNull(branches.archivedAt))
      .orderBy(...OLDEST_FIRST);
    // Oldest first, and the oldest is never archived, so it is first in either list.
    return rows.map(({ branch, computers, staff }, index) => ({
      id: branch.id,
      code: branch.code,
      name: branch.name,
      address: branch.address,
      pinCode: branch.pinCode,
      stateCode: branch.stateCode,
      gstin: branch.gstin,
      drugLicence: branch.drugLicence,
      fssai: branch.fssai,
      headOffice: index === 0,
      archived: branch.archivedAt !== null,
      computers,
      staff,
    }));
  }
}
