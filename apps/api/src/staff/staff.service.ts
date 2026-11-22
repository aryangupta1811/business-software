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
  attendanceMarks,
  branches,
  businesses,
  desc,
  eq,
  inArray,
  isNull,
  recordEntry,
  salaryRates,
  sessions,
  sql,
  staffBranches,
  users,
  type Database,
  type Transaction,
} from '@business-software/db';
import {
  businessDate,
  differenceFromDefaults,
  effectiveDiscountLimit,
  effectivePermissions,
  permissionsProblem,
  salaryRateFor,
  salaryRateProblem,
  STAFF_SWITCHES,
  staffPasswordProblem,
  type NewStaffInput,
  type Permission,
  type SalaryKind,
  type SalaryRate,
  type SalaryRateInput,
  type SalaryRateView,
  type StaffAddLoginInput,
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
  phone: users.phone,
  joiningDate: users.joiningDate,
  weeklyOffDay: users.weeklyOffDay,
  paidLeavesPerMonth: users.paidLeavesPerMonth,
  overtimeRatePaise: users.overtimeRatePaise,
  version: users.version,
};

/** A person's rates are read in the order they were made, which `salaryRateFor` needs. */
const RATE_COLUMNS = {
  userId: salaryRates.userId,
  fromMonth: salaryRates.fromMonth,
  kind: salaryRates.kind,
  amountPaise: salaryRates.amountPaise,
};

/** A rate as the screens and the code read it; `kind` is checked by the database. */
function toRate(row: { fromMonth: string; kind: string; amountPaise: number }): SalaryRate {
  return { fromMonth: row.fromMonth, kind: row.kind as SalaryKind, amountPaise: row.amountPaise };
}

function toRateView(row: {
  id: string;
  fromMonth: string;
  kind: string;
  amountPaise: number;
  createdAt: Date;
}): SalaryRateView {
  return { ...toRate(row), id: row.id, createdAt: row.createdAt.toISOString() };
}

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
    phone: string | null;
    joiningDate: string | null;
    weeklyOffDay: number | null;
    paidLeavesPerMonth: number;
    overtimeRatePaise: number | null;
    version: number;
  },
  extraBranchIds: string[],
  salary: SalaryRate | null,
): StaffView {
  if (row.homeBranchId === null) throw new Error('Staff row has no home branch');
  if (row.joiningDate === null) throw new Error('Staff row has no joining date');
  return {
    id: row.id,
    name: row.name ?? row.username ?? '',
    username: row.username,
    phone: row.phone,
    joiningDate: row.joiningDate,
    weeklyOffDay: row.weeklyOffDay,
    paidLeavesPerMonth: row.paidLeavesPerMonth,
    overtimeRatePaise: row.overtimeRatePaise,
    salary,
    version: row.version,
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

/** What the log records of a person's record fields. */
function recordOf(view: StaffView) {
  return {
    phone: view.phone,
    joiningDate: view.joiningDate,
    weeklyOffDay: view.weeklyOffDay,
    paidLeavesPerMonth: view.paidLeavesPerMonth,
    overtimeRatePaise: view.overtimeRatePaise,
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
      const rates = await tx
        .select(RATE_COLUMNS)
        .from(salaryRates)
        .orderBy(asc(salaryRates.createdAt), asc(salaryRates.id));
      const month = this.thisMonth();
      return rows.map((row) =>
        toView(
          row,
          extras.filter((extra) => extra.userId === row.id).map((extra) => extra.branchId),
          salaryRateFor(rates.filter((rate) => rate.userId === row.id).map(toRate), month),
        ),
      );
    });
  }

  /**
   * A new person. With a login (`username` and `password`) omitted switches take the defaults
   * and the owner's password is needed; without one it is a record only (`00` #19). A first
   * salary becomes the first rate, from this month or the joining month if that is later.
   */
  async create(caller: Caller, input: NewStaffInput): Promise<StaffView> {
    const login = await this.prepareLogin(caller, input);
    const today = businessDate(this.clock.now());
    const joiningDate = input.joiningDate ?? today;
    return inBusiness(this.database, caller, async (tx) => {
      await this.requireActiveBranch(tx, input.homeBranchId);
      const [inserted] = await tx
        .insert(users)
        .values({
          businessId: caller.businessId,
          role: 'staff',
          name: input.name,
          homeBranchId: input.homeBranchId,
          phone: input.phone ?? null,
          joiningDate,
          weeklyOffDay: input.weeklyOffDay ?? null,
          paidLeavesPerMonth: input.paidLeavesPerMonth ?? 0,
          overtimeRatePaise: input.overtimeRatePaise ?? null,
          ...login,
        })
        .returning({ id: users.id });
      if (inserted === undefined) throw new Error('No staff row returned');
      if (input.salary !== undefined) {
        const month = joiningDate.slice(0, 7) > today.slice(0, 7) ? joiningDate : today;
        await this.addRate(
          tx,
          caller,
          inserted.id,
          input.homeBranchId,
          month.slice(0, 7),
          input.salary,
        );
      }
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
          ...recordOf(view),
          ...(login !== null && accessOf(view)),
        },
      });
      return view;
    });
  }

  /** Gives a record without a login its username and password. Needs the owner's password. */
  async addLogin(caller: Caller, id: string, input: StaffAddLoginInput): Promise<StaffView> {
    const login = await this.prepareLogin(caller, input);
    if (login === null) throw new Error('A login needs a username and a password');
    return inBusiness(this.database, caller, async (tx) => {
      const current = await this.load(tx, id, true);
      if (current.username !== null) throw new ConflictException({ code: 'has_login' });
      await tx
        .update(users)
        .set({ ...login, version: sql`${users.version} + 1` })
        .where(eq(users.id, id));
      const view = await this.load(tx, id);
      await recordEntry(tx, {
        actorId: caller.userId,
        action: 'staff.login_added',
        entityType: 'user',
        entityId: id,
        branchId: current.homeBranchId,
        after: { username: view.username, ...accessOf(view) },
      });
      return view;
    });
  }

  /**
   * Name, home branch, username (a login's only) and the record fields; a field left out stays as
   * it was. No permission change here, no owner's password.
   */
  update(caller: Caller, id: string, input: StaffUpdateInput): Promise<StaffView> {
    return inBusiness(this.database, caller, async (tx) => {
      const current = await this.load(tx, id, true);
      if (input.version !== undefined && input.version !== current.version) {
        throw new ConflictException({ code: 'stale' });
      }
      // A record without a login has no username to change; "Give a login" makes one.
      if (input.username !== undefined && current.username === null) {
        throw new ConflictException({ code: 'no_login' });
      }
      // An unchanged home may be archived already (a deactivated login); a new one may not.
      if (input.homeBranchId !== current.homeBranchId) {
        await this.requireActiveBranch(tx, input.homeBranchId);
      }
      const joiningDate = input.joiningDate ?? current.joiningDate;
      if (joiningDate !== current.joiningDate) {
        // A mark before the new joining date would be off the register.
        const [first] = await tx
          .select({ date: sql<string | null>`min(${attendanceMarks.date})` })
          .from(attendanceMarks)
          .where(eq(attendanceMarks.userId, id));
        if (first?.date != null && first.date < joiningDate) {
          throw new ConflictException({ code: 'marks_before_joining' });
        }
      }
      const next = {
        name: input.name,
        username: input.username ?? current.username,
        homeBranchId: input.homeBranchId,
        phone: input.phone === undefined ? current.phone : input.phone,
        joiningDate,
        weeklyOffDay: input.weeklyOffDay === undefined ? current.weeklyOffDay : input.weeklyOffDay,
        paidLeavesPerMonth: input.paidLeavesPerMonth ?? current.paidLeavesPerMonth,
        overtimeRatePaise:
          input.overtimeRatePaise === undefined
            ? current.overtimeRatePaise
            : input.overtimeRatePaise,
      };
      const changed = changes({ ...current }, next);
      if (changed === null) return current;
      await tx
        .update(users)
        .set({ ...next, version: sql`${users.version} + 1` })
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

  /** A person's rates, newest start first (`05` #3): the history the Staff page shows. */
  salaryRates(caller: Caller, id: string): Promise<SalaryRateView[]> {
    return inBusiness(this.database, caller, async (tx) => {
      await this.load(tx, id);
      const rows = await tx
        .select({ ...RATE_COLUMNS, id: salaryRates.id, createdAt: salaryRates.createdAt })
        .from(salaryRates)
        .where(eq(salaryRates.userId, id))
        .orderBy(desc(salaryRates.fromMonth), desc(salaryRates.createdAt), desc(salaryRates.id));
      return rows.map(toRateView);
    });
  }

  /** A new rate from the 1st of `fromMonth`, this month or later (`05` #30). Old rates stay. */
  setSalaryRate(caller: Caller, id: string, input: SalaryRateInput): Promise<SalaryRateView> {
    if (salaryRateProblem(input.fromMonth, businessDate(this.clock.now())) !== null) {
      throw new BadRequestException({ code: 'invalid_body', fields: { fromMonth: 'past_month' } });
    }
    return inBusiness(this.database, caller, async (tx) => {
      const current = await this.load(tx, id, true);
      const made = await tx
        .select(RATE_COLUMNS)
        .from(salaryRates)
        .where(eq(salaryRates.userId, id))
        .orderBy(asc(salaryRates.createdAt), asc(salaryRates.id));
      const previous = salaryRateFor(made.map(toRate), input.fromMonth);
      return this.addRate(tx, caller, id, current.homeBranchId, input.fromMonth, input, previous);
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
    const rates = await tx
      .select(RATE_COLUMNS)
      .from(salaryRates)
      .where(eq(salaryRates.userId, id))
      .orderBy(asc(salaryRates.createdAt), asc(salaryRates.id));
    return toView(
      row,
      extras.map((extra) => extra.branchId),
      salaryRateFor(rates.map(toRate), this.thisMonth()),
    );
  }

  /** The current month in India, `YYYY-MM`. */
  private thisMonth(): string {
    return businessDate(this.clock.now()).slice(0, 7);
  }

  /** Writes a rate from the 1st of `month` (`YYYY-MM`) and its log entry. */
  private async addRate(
    tx: Transaction,
    caller: Caller,
    userId: string,
    branchId: string,
    month: string,
    rate: { kind: SalaryKind; amountPaise: number },
    previous: SalaryRate | null = null,
  ): Promise<SalaryRateView> {
    const [row] = await tx
      .insert(salaryRates)
      .values({
        userId,
        fromMonth: `${month}-01`,
        kind: rate.kind,
        amountPaise: rate.amountPaise,
        createdBy: caller.userId,
      })
      .returning({ ...RATE_COLUMNS, id: salaryRates.id, createdAt: salaryRates.createdAt });
    if (row === undefined) throw new Error('No salary rate returned');
    await recordEntry(tx, {
      actorId: caller.userId,
      action: 'staff.salary_set',
      entityType: 'user',
      entityId: userId,
      branchId,
      ...(previous !== null && { before: { ...previous } }),
      after: { ...toRate(row) },
    });
    return toRateView(row);
  }

  /**
   * What a new login needs before its row is written: the checks, the owner's password, and the
   * hash (made outside the transaction, in the one Argon2 queue). Null for a record without one.
   */
  private async prepareLogin(
    caller: Caller,
    input: {
      username?: string | undefined;
      password?: string | undefined;
      ownerPassword?: string | undefined;
      permissions?: string[] | undefined;
      discountLimitBasisPoints?: number | null | undefined;
    },
  ) {
    const { username, password, ownerPassword } = input;
    if (username === undefined || password === undefined || ownerPassword === undefined) {
      return null;
    }
    const wanted = (input.permissions ?? DEFAULT_SWITCHES) as Permission[];
    refuseBadSwitches(wanted);
    const phone = await this.phoneOf(caller);
    refuseWeak('password', staffPasswordProblem(password, { username, phone }));
    await this.sessions.requireOwnerPassword(caller, ownerPassword);
    const passwordHash = await this.sessions.hashNewPassword(password);
    const { added, removed } = differenceFromDefaults(wanted);
    return {
      username,
      passwordHash,
      passwordChangedAt: this.clock.now(),
      permissionsAdded: added,
      permissionsRemoved: removed,
      // The limit is kept while the discount switch is on (design section 3).
      discountLimitBasisPoints: wanted.includes('billing.discount')
        ? (input.discountLimitBasisPoints ?? null)
        : null,
    };
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
