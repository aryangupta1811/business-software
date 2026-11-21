// Staff logins and their permissions (P1.5 design, sections 3–5; Module 00 #15–#17, #33–#35,
// #44, #47–#53; ADR 0044). Each change and its log entry commit together; password hashes are
// made outside the transaction in the one Argon2 queue; the owner's password is checked by
// the session service (rate-limited per session) before anything is written.
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  and,
  asc,
  branches,
  businesses,
  eq,
  inArray,
  isNull,
  recordEntry,
  sessions,
  staffBranches,
  users,
  type Database,
  type Transaction,
} from '@business-software/db';
import {
  differenceFromDefaults,
  effectiveDiscountLimit,
  effectivePermissions,
  permissionsProblem,
  STAFF_SWITCHES,
  staffPasswordProblem,
  type NewStaffInput,
  type Permission,
  type StaffBranchesInput,
  type StaffDeactivateInput,
  type StaffPasswordInput,
  type StaffPermissionsInput,
  type StaffUpdateInput,
  type StaffView,
} from '@business-software/shared';
import { CLOCK, type Clock } from '../auth/clock.js';
import { SESSION_SERVICE, type SessionService } from '../auth/session.service.js';
import { DATABASE } from '../database.module.js';
import type { Caller } from '../http/session.js';
import { changes, inBusiness } from '../items/conflicts.js';

const DEFAULT_SWITCHES: readonly Permission[] = STAFF_SWITCHES.filter((entry) => entry.default).map(
  (entry) => entry.permission,
);

/** The columns a staff row is read with, and its home branch's name. */
const COLUMNS = {
  id: users.id,
  name: users.name,
  username: users.username,
  homeBranchId: users.homeBranchId,
  homeBranchName: branches.name,
  deactivatedAt: users.deactivatedAt,
  permissionsAdded: users.permissionsAdded,
  permissionsRemoved: users.permissionsRemoved,
  discountLimitBasisPoints: users.discountLimitBasisPoints,
};

function toView(
  row: {
    id: string;
    name: string | null;
    username: string | null;
    homeBranchId: string | null;
    homeBranchName: string;
    deactivatedAt: Date | null;
    permissionsAdded: string[];
    permissionsRemoved: string[];
    discountLimitBasisPoints: number | null;
  },
  extraBranchIds: string[],
): StaffView {
  if (row.homeBranchId === null) throw new Error('Staff row has no home branch');
  return {
    id: row.id,
    name: row.name ?? row.username ?? '',
    username: row.username,
    homeBranchId: row.homeBranchId,
    homeBranchName: row.homeBranchName,
    extraBranchIds,
    active: row.deactivatedAt === null,
    permissions: effectivePermissions({
      added: row.permissionsAdded,
      removed: row.permissionsRemoved,
    }),
    discountLimitBasisPoints: row.discountLimitBasisPoints,
  };
}

/** What the log records of a login's access: the effective list and the effective limit. */
function accessOf(view: StaffView) {
  return {
    permissions: view.permissions,
    discountLimitBasisPoints: effectiveDiscountLimit(
      'staff',
      view.permissions,
      view.discountLimitBasisPoints,
    ),
  };
}

/** `422` with the code the web app translates; see `permissionsProblem`. */
function refuseBadSwitches(permissions: readonly string[]): void {
  const problem = permissionsProblem(permissions);
  if (problem !== null) {
    throw new UnprocessableEntityException({ code: 'invalid_permissions', ...problem });
  }
}

/** The same shape as a schema error, so the form shows it under the password box. */
function refuseWeak(field: 'password' | 'newPassword', problem: string | null): void {
  if (problem !== null) {
    throw new BadRequestException({ code: 'invalid_body', fields: { [field]: problem } });
  }
}

@Injectable()
export class StaffService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  list(caller: Caller, includeInactive: boolean): Promise<StaffView[]> {
    return inBusiness(this.database, caller, async (tx) => {
      const rows = await tx
        .select(COLUMNS)
        .from(users)
        .innerJoin(branches, this.homeBranch())
        .where(
          and(eq(users.role, 'staff'), includeInactive ? undefined : isNull(users.deactivatedAt)),
        )
        .orderBy(asc(users.name), asc(users.id));
      const extras = await tx
        .select({ userId: staffBranches.userId, branchId: staffBranches.branchId })
        .from(staffBranches)
        .orderBy(asc(staffBranches.branchId));
      return rows.map((row) =>
        toView(
          row,
          extras.filter((extra) => extra.userId === row.id).map((extra) => extra.branchId),
        ),
      );
    });
  }

  /** A new login; omitted switches take the defaults. Needs the owner's password. */
  async create(caller: Caller, input: NewStaffInput): Promise<StaffView> {
    const wanted = (input.permissions ?? DEFAULT_SWITCHES) as Permission[];
    refuseBadSwitches(wanted);
    const phone = await this.phoneOf(caller);
    refuseWeak(
      'password',
      staffPasswordProblem(input.password, { username: input.username, phone }),
    );
    await this.sessions.requireOwnerPassword(caller, input.ownerPassword);
    const passwordHash = await this.sessions.hashNewPassword(input.password);
    const { added, removed } = differenceFromDefaults(wanted);
    return inBusiness(this.database, caller, async (tx) => {
      await this.requireActiveBranch(tx, input.homeBranchId);
      const [inserted] = await tx
        .insert(users)
        .values({
          businessId: caller.businessId,
          role: 'staff',
          name: input.name,
          username: input.username,
          passwordHash,
          passwordChangedAt: this.clock.now(),
          homeBranchId: input.homeBranchId,
          permissionsAdded: added,
          permissionsRemoved: removed,
          // The limit is kept while the discount switch is on (design section 3).
          discountLimitBasisPoints: wanted.includes('billing.discount')
            ? (input.discountLimitBasisPoints ?? null)
            : null,
        })
        .returning({ id: users.id });
      if (inserted === undefined) throw new Error('No staff row returned');
      const view = await this.load(tx, inserted.id);
      await recordEntry(tx, {
        actorId: caller.userId,
        action: 'staff.created',
        entityType: 'user',
        entityId: view.id,
        branchId: view.homeBranchId,
        after: {
          name: view.name,
          username: view.username,
          homeBranchId: view.homeBranchId,
          ...accessOf(view),
        },
      });
      return view;
    });
  }

  /** Name, username and home branch. No permission change here, no owner's password. */
  update(caller: Caller, id: string, input: StaffUpdateInput): Promise<StaffView> {
    return inBusiness(this.database, caller, async (tx) => {
      const current = await this.load(tx, id, true);
      // An unchanged home may be archived already (a deactivated login); a new one may not.
      if (input.homeBranchId !== current.homeBranchId) {
        await this.requireActiveBranch(tx, input.homeBranchId);
      }
      const fields = (view: Pick<StaffView, 'name' | 'username' | 'homeBranchId'>) => ({
        name: view.name,
        username: view.username,
        homeBranchId: view.homeBranchId,
      });
      const changed = changes(fields(current), fields(input));
      if (changed === null) return current;
      await tx
        .update(users)
        .set({ name: input.name, username: input.username, homeBranchId: input.homeBranchId })
        .where(eq(users.id, id));
      const view = await this.load(tx, id);
      await recordEntry(tx, {
        actorId: caller.userId,
        action: 'staff.updated',
        entityType: 'user',
        entityId: id,
        branchId: view.homeBranchId,
        ...changed,
      });
      return view;
    });
  }

  /** The whole switch set and limit. Needs the owner's password (`00` #17). */
  async setPermissions(
    caller: Caller,
    id: string,
    input: StaffPermissionsInput,
  ): Promise<StaffView> {
    refuseBadSwitches(input.permissions);
    await this.sessions.requireOwnerPassword(caller, input.ownerPassword);
    const { added, removed } = differenceFromDefaults(input.permissions as Permission[]);
    return inBusiness(this.database, caller, async (tx) => {
      const current = await this.load(tx, id, true);
      // While the discount switch is off the stored limit stays, so turning it on again
      // brings it back.
      const limit = input.permissions.includes('billing.discount')
        ? input.discountLimitBasisPoints
        : current.discountLimitBasisPoints;
      await tx
        .update(users)
        .set({
          permissionsAdded: added,
          permissionsRemoved: removed,
          discountLimitBasisPoints: limit,
        })
        .where(eq(users.id, id));
      const view = await this.load(tx, id);
      const before = accessOf(current);
      const after = accessOf(view);
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        await recordEntry(tx, {
          actorId: caller.userId,
          action: 'staff.permissions_changed',
          entityType: 'user',
          entityId: id,
          branchId: view.homeBranchId,
          before,
          after,
        });
      }
      return view;
    });
  }

  /** The owner sets a forgotten password (#33): every session of that login ends. */
  async resetPassword(caller: Caller, id: string, input: StaffPasswordInput): Promise<void> {
    const phone = await this.phoneOf(caller);
    const target = await inBusiness(this.database, caller, (tx) => this.load(tx, id));
    refuseWeak(
      'newPassword',
      staffPasswordProblem(input.newPassword, { username: target.username, phone }),
    );
    await this.sessions.requireOwnerPassword(caller, input.ownerPassword);
    const passwordHash = await this.sessions.hashNewPassword(input.newPassword);
    await inBusiness(this.database, caller, async (tx) => {
      const current = await this.load(tx, id, true);
      await this.sessions.setPasswordIn(tx, id, passwordHash, 'reset');
      await recordEntry(tx, {
        actorId: caller.userId,
        action: 'user.password_reset',
        entityType: 'user',
        entityId: id,
        branchId: current.homeBranchId,
        after: { via: 'owner' },
      });
    });
  }

  /** Takes access away at once: the login's open sessions end in the same transaction. */
  deactivate(caller: Caller, id: string, input: StaffDeactivateInput): Promise<StaffView> {
    return inBusiness(this.database, caller, async (tx) => {
      const current = await this.load(tx, id, true);
      if (!current.active) return current;
      await tx.update(users).set({ deactivatedAt: this.clock.now() }).where(eq(users.id, id));
      await this.sessions.endSessionsIn(tx, eq(sessions.userId, id), 'deactivated');
      await recordEntry(tx, {
        actorId: caller.userId,
        action: 'staff.deactivated',
        entityType: 'user',
        entityId: id,
        branchId: current.homeBranchId,
        ...(input.reason !== undefined && { reason: input.reason }),
      });
      return this.load(tx, id);
    });
  }

  /**
   * The extra branches a login may work at (P1.6, owner answer 4A), the whole list. Needs the
   * owner's password: it gives access (P1.5 question 3). Only the next request of a logged-in
   * cashier notices; the session service reads the list with the permissions.
   */
  async setBranches(caller: Caller, id: string, input: StaffBranchesInput): Promise<StaffView> {
    await this.sessions.requireOwnerPassword(caller, input.ownerPassword);
    return inBusiness(this.database, caller, async (tx) => {
      const current = await this.load(tx, id, true);
      const wanted = [...input.branchIds].sort();
      const invalid = { code: 'invalid_body', fields: { branchIds: 'invalid' } };
      // The home branch is always allowed, so it isn't kept as an extra; the rest must be live.
      if (wanted.includes(current.homeBranchId)) throw new BadRequestException(invalid);
      if (wanted.length > 0) {
        const live = await tx
          .select({ id: branches.id })
          .from(branches)
          .where(and(inArray(branches.id, wanted), isNull(branches.archivedAt)))
          .for('share');
        if (live.length !== wanted.length) throw new BadRequestException(invalid);
      }
      const before = current.extraBranchIds;
      const removed = before.filter((branchId) => !wanted.includes(branchId));
      const added = wanted.filter((branchId) => !before.includes(branchId));
      if (removed.length === 0 && added.length === 0) return current;
      if (removed.length > 0) {
        await tx
          .delete(staffBranches)
          .where(and(eq(staffBranches.userId, id), inArray(staffBranches.branchId, removed)));
      }
      if (added.length > 0) {
        await tx
          .insert(staffBranches)
          .values(
            added.map((branchId) => ({ businessId: caller.businessId, userId: id, branchId })),
          );
      }
      await recordEntry(tx, {
        actorId: caller.userId,
        action: 'staff.branches_changed',
        entityType: 'user',
        entityId: id,
        branchId: current.homeBranchId,
        before: { extraBranchIds: before },
        after: { extraBranchIds: wanted },
      });
      return this.load(tx, id);
    });
  }

  /** Brings a login back with the permissions it had. Needs the owner's password. */
  async reactivate(caller: Caller, id: string, ownerPassword: string): Promise<StaffView> {
    await this.sessions.requireOwnerPassword(caller, ownerPassword);
    return inBusiness(this.database, caller, async (tx) => {
      const current = await this.load(tx, id, true);
      if (current.active) return current;
      // Nothing may point at a closed shop: the owner moves the login to a live branch first.
      await this.requireActiveBranch(tx, current.homeBranchId, 'home_branch_archived');
      await tx.update(users).set({ deactivatedAt: null }).where(eq(users.id, id));
      await recordEntry(tx, {
        actorId: caller.userId,
        action: 'staff.reactivated',
        entityType: 'user',
        entityId: id,
        branchId: current.homeBranchId,
      });
      return this.load(tx, id);
    });
  }

  // ---------------------------------------------------------------------------------------

  private homeBranch() {
    return and(eq(branches.businessId, users.businessId), eq(branches.id, users.homeBranchId));
  }

  /** A staff login of this business (never the owner's row), locked for a change; else 404. */
  private async load(tx: Transaction, id: string, lock = false): Promise<StaffView> {
    const query = tx
      .select(COLUMNS)
      .from(users)
      .innerJoin(branches, this.homeBranch())
      .where(and(eq(users.id, id), eq(users.role, 'staff')));
    const [row] = await (lock ? query.for('update', { of: users }) : query);
    if (row === undefined) throw new NotFoundException({ code: 'not_found' });
    const extras = await tx
      .select({ branchId: staffBranches.branchId })
      .from(staffBranches)
      .where(eq(staffBranches.userId, id))
      .orderBy(asc(staffBranches.branchId));
    return toView(
      row,
      extras.map((extra) => extra.branchId),
    );
  }

  /**
   * A live branch of this business, locked FOR SHARE so it can't be archived (which locks it
   * FOR UPDATE) between this check and the commit. With `archivedCode`, a branch that is
   * archived answers that 409 instead of the 400 for one that isn't the business's.
   */
  private async requireActiveBranch(
    tx: Transaction,
    branchId: string,
    archivedCode?: string,
  ): Promise<void> {
    const [branch] = await tx
      .select({ archivedAt: branches.archivedAt })
      .from(branches)
      .where(eq(branches.id, branchId))
      .for('share');
    if (branch === undefined) {
      throw new BadRequestException({ code: 'invalid_body', fields: { homeBranchId: 'invalid' } });
    }
    if (branch.archivedAt !== null) {
      if (archivedCode !== undefined) throw new ConflictException({ code: archivedCode });
      throw new BadRequestException({ code: 'invalid_body', fields: { homeBranchId: 'invalid' } });
    }
  }

  /** The business phone a staff password may not be (Module 00 #7). */
  private phoneOf(caller: Caller): Promise<string> {
    return inBusiness(this.database, caller, async (tx) => {
      const [row] = await tx.select({ phone: businesses.phone }).from(businesses);
      if (row === undefined) throw new Error('Business not found');
      return row.phone;
    });
  }
}
