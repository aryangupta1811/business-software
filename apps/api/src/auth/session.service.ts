// Logins and sessions (ADR 0009; P1.4 design, sections 3–7; Module 00 #21, #27–#29, #34,
// #37–#41). Every lookup after login-by-email runs under RLS for the business in the cookie.
import {
  alsoInBusiness,
  and,
  asc,
  authTokens,
  branches,
  businesses,
  devices,
  eq,
  isNull,
  recordEntry,
  sessions,
  sql,
  staffBranches,
  users,
  withBusiness,
  type Database,
  type SessionEndReason,
  type SQL,
  type Transaction,
} from '@business-software/db';
import {
  effectiveDiscountLimit,
  effectivePermissions,
  IDLE_GRACE_MS,
  PERMISSIONS,
  type ActiveSession,
  type ReceiptSize,
  type BranchRef,
  type PermissionDifference,
  type SessionView,
} from '@business-software/shared';
import type { IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Caller } from '../http/session.js';
import type { Clock } from './clock.js';
import {
  cookieNames,
  DEVICE_MAX_AGE_SECONDS,
  parseCookies,
  serializeCookie,
  type CookieNames,
} from './cookies.js';
import type { HashGate } from './hash-gate.js';
import { hashPassword, needsRehash, verifyPassword } from './password.js';
import { RateLimiter, type Verdict } from './rate-limit.js';
import {
  csrfTokenFor,
  formatCookieToken,
  hashToken,
  newToken,
  readCookieToken,
  type CookieToken,
} from './tokens.js';

/** Injection token for the one SessionService. */
export const SESSION_SERVICE = 'SESSION_SERVICE';

const MINUTE = 60_000;

/** A wrong email, username or password: one answer for all (P1.4 design, section 5). */
export class WrongLoginError extends Error {
  constructor() {
    super('Wrong login');
  }
}

/** Too many attempts (Module 00 #41); try again at `retryAt`. */
export class TooManyAttemptsError extends Error {
  constructor(readonly retryAt: Date) {
    super('Too many attempts');
  }
}

/** A staff login on a computer that doesn't know its business yet (#28). */
export class NoDeviceError extends Error {
  constructor() {
    super('This computer has no business');
  }
}

/** A session that just ended (staff idle, deactivated): the screen says so. */
export class SessionEndedError extends Error {
  constructor() {
    super('Session ended');
  }
}

/** The owner's first login on a new computer, with several branches: it must say which (P1.6). */
export class ChooseBranchError extends Error {
  constructor(readonly branches: BranchRef[]) {
    super('Choose the computer branch');
  }
}

/** The branch sent with a first login isn't one of the business's active branches. */
export class InvalidBranchError extends Error {
  constructor() {
    super('Not an active branch');
  }
}

/** A staff login on a computer at a branch they may not work at (Module 00 #35). */
export class WrongBranchError extends Error {
  constructor(readonly branchName: string) {
    super('Wrong branch');
  }
}

/** A wrong current or owner password on a signed-in screen (#17, #46). */
export class WrongPasswordError extends Error {
  constructor() {
    super('Wrong password');
  }
}

/** Rate limits (Module 00 #41; P1.4 design, section 7). */
export class LoginLimits {
  /** Attempts per computer (IP address). */
  readonly ip: RateLimiter;
  /** Wrong passwords per login. */
  readonly failures: RateLimiter;
  readonly signup: RateLimiter;
  /** Wrong unlock passwords per session. */
  readonly unlock: RateLimiter;
  /** Owner-password and current-password checks per session (section 6). */
  readonly ownerPassword: RateLimiter;
  /** Reset-link requests per IP, and reset-link requests and "Send again" per email or user. */
  readonly recoveryByIp: RateLimiter;
  readonly recoveryByAccount: RateLimiter;
  /**
   * Wrong recovery keys per IP, and nothing per email (owner, 2026-11-20; #41). Only wrong keys
   * count, and a right key is never refused, so neither a stranger who knows the email nor one
   * sharing the owner's IP can lock the owner out.
   */
  readonly recoveryKeyByIp: RateLimiter;

  constructor(clock: Clock) {
    this.ip = new RateLimiter(30, 15 * MINUTE, clock);
    this.failures = new RateLimiter(10, 15 * MINUTE, clock);
    this.signup = new RateLimiter(5, 60 * MINUTE, clock);
    this.unlock = new RateLimiter(10, 15 * MINUTE, clock);
    this.ownerPassword = new RateLimiter(10, 15 * MINUTE, clock);
    this.recoveryByIp = new RateLimiter(5, 60 * MINUTE, clock);
    this.recoveryByAccount = new RateLimiter(5, 60 * MINUTE, clock);
    this.recoveryKeyByIp = new RateLimiter(5, 60 * MINUTE, clock);
  }
}

export interface RequestContext {
  ip: string;
  userAgent: string | undefined;
  cookies: Map<string, string>;
}

/** An owner found by email (ADR 0039). */
export interface OwnerLogin {
  businessId: string;
  userId: string;
}

export interface LoginResult {
  setCookies: string[];
  view: ActiveSession;
}

/** A device row and the cookie that names it. */
interface FoundDevice {
  id: string;
  branchId: string;
  cookie: CookieToken;
}

interface StartOptions {
  businessId: string;
  userId: string;
  role: 'owner' | 'staff';
  /**
   * The computer's device row, or none: an owner login registers the computer (#37) at
   * `newDeviceBranchId`, which `branchForNewComputer` picked.
   */
  device: FoundDevice | null;
  newDeviceBranchId?: string | undefined;
}

export function throwUnless(verdict: Verdict): void {
  if (!verdict.allowed) throw new TooManyAttemptsError(verdict.retryAt);
}

export interface AuthSettings {
  cookieSecure: boolean;
  /** Module 00 #45: the demo's email reaches verified addresses only. */
  emailLimited: boolean;
}

export class SessionService {
  private readonly names: CookieNames;
  // Checked against when the login doesn't exist, so the answer takes as long (section 5).
  private standIn: Promise<string> | undefined;

  constructor(
    private readonly database: Database,
    private readonly settings: AuthSettings,
    private readonly clock: Clock,
    readonly limits: LoginLimits,
    /** The one Argon2 queue, shared with signup (ADR 0038). */
    private readonly gate: HashGate,
  ) {
    this.names = cookieNames(settings.cookieSecure);
  }

  /** The cookies, the client's IP (one trusted proxy, see app.ts) and browser. */
  contextOf(request: IncomingMessage): RequestContext {
    const ip = (request as IncomingMessage & { ip?: string }).ip ?? request.socket.remoteAddress;
    const agent = request.headers['user-agent'];
    return {
      ip: ip ?? 'unknown',
      userAgent: typeof agent === 'string' ? agent.slice(0, 200) : undefined,
      cookies: parseCookies(request.headers.cookie),
    };
  }

  /**
   * The one cross-business read (ADR 0039): which business and owner an email belongs to.
   * Never a password hash: that is read under RLS once the business is known.
   */
  async findOwnerLogin(email: string): Promise<OwnerLogin | undefined> {
    const { rows } = await this.database.db.execute<{ business_id: string; user_id: string }>(
      sql`select business_id, user_id from app_find_owner_login(${email})`,
    );
    const row = rows[0];
    return row === undefined ? undefined : { businessId: row.business_id, userId: row.user_id };
  }

  /** Module 00 #27: email and password. */
  async loginOwner(
    email: string,
    password: string,
    context: RequestContext,
    branchId?: string,
  ): Promise<LoginResult> {
    throwUnless(this.limits.ip.hit(context.ip));
    // Counted before the password is checked, so simultaneous guesses can't pass the limit;
    // a right password takes the count back.
    const loginKey = `owner:${email}`;
    throwUnless(this.limits.failures.hit(loginKey));
    const found = await this.findOwnerLogin(email);
    const user =
      found === undefined
        ? undefined
        : await withBusiness(this.database.db, found.businessId, async (tx) => {
            const [row] = await tx
              .select({ passwordHash: users.passwordHash, deactivatedAt: users.deactivatedAt })
              .from(users)
              .where(eq(users.id, found.userId));
            return row;
          });
    const ok = await this.checkPassword(password, user?.passwordHash ?? null);
    if (!ok || found === undefined || user?.deactivatedAt !== null) throw new WrongLoginError();
    this.limits.failures.reset(loginKey);
    const rehash = await this.rehashIfOld(password, user.passwordHash);
    const businessId = found.businessId;
    // One transaction: the new session and the end of the old, or neither (#18).
    return withBusiness(this.database.db, businessId, async (tx) => {
      await rehash?.(tx, found.userId);
      const device = await this.findDeviceIn(tx, businessId, context);
      const newDeviceBranchId =
        device === null ? await this.branchForNewComputer(tx, branchId) : undefined;
      return this.startIn(
        tx,
        { businessId, userId: found.userId, role: 'owner', device, newDeviceBranchId },
        context,
      );
    });
  }

  /** Module 00 #28: username and password, on a computer that knows its business. */
  async loginStaff(username: string, password: string, context: RequestContext) {
    throwUnless(this.limits.ip.hit(context.ip));
    const businessId = readCookieToken(context.cookies.get(this.names.device))?.businessId;
    if (businessId === undefined) throw new NoDeviceError();
    const found = await withBusiness(this.database.db, businessId, async (tx) => {
      const device = await this.findDeviceIn(tx, businessId, context);
      if (device === null) return null;
      const [user] = await tx
        .select({
          id: users.id,
          passwordHash: users.passwordHash,
          deactivatedAt: users.deactivatedAt,
        })
        .from(users)
        .where(and(eq(users.username, username), eq(users.role, 'staff')));
      return { device, user };
    });
    if (found === null) throw new NoDeviceError();
    const { device, user } = found;
    const loginKey = `staff:${businessId}:${username}`;
    throwUnless(this.limits.failures.hit(loginKey));
    const ok = await this.checkPassword(password, user?.passwordHash ?? null);
    if (!ok || user?.deactivatedAt !== null) throw new WrongLoginError();
    this.limits.failures.reset(loginKey);
    const rehash = await this.rehashIfOld(password, user.passwordHash);
    return withBusiness(this.database.db, businessId, async (tx) => {
      await rehash?.(tx, user.id);
      return this.startIn(tx, { businessId, userId: user.id, role: 'staff', device }, context);
    });
  }

  /**
   * Signup's last step, inside its transaction (Module 00 #37): the owner is logged in, the
   * computer becomes the business's counter, and the browser's old session ends (#18).
   */
  async startInTransaction(
    tx: Transaction,
    businessId: string,
    userId: string,
    context: RequestContext,
  ): Promise<string[]> {
    const newDeviceBranchId = await this.branchForNewComputer(tx);
    const { setCookies } = await this.startIn(
      tx,
      { businessId, userId, role: 'owner', device: null, newDeviceBranchId },
      context,
    );
    return setCookies;
  }

  /** Who is calling, applying the lock and idle rules (Module 00 #21, #29, #34). */
  async resolve(request: IncomingMessage): Promise<Caller | null> {
    const cookie = readCookieToken(this.contextOf(request).cookies.get(this.names.session));
    if (cookie === null) return null;
    const outcome = await withBusiness(this.database.db, cookie.businessId, (tx) =>
      this.applyRules(tx, cookie),
    );
    if (outcome === 'ended') throw new SessionEndedError();
    return outcome;
  }

  /**
   * Someone is at the counter: a write that passed the CSRF check, or the web app's "still
   * here" (P1.4 design, section 5). Reads don't count, so a tab that refetches by itself can't
   * keep the owner's screen open (#21).
   */
  async recordActivity(caller: Caller): Promise<void> {
    if (caller.locked) return;
    await withBusiness(this.database.db, caller.businessId, (tx) =>
      tx
        .update(sessions)
        .set({ lastActiveAt: this.clock.now() })
        .where(
          and(
            eq(sessions.id, caller.sessionId),
            isNull(sessions.endedAt),
            isNull(sessions.lockedAt),
          ),
        ),
    );
  }

  /** `GET /api/session`: the session, or which business this computer remembers. */
  async view(request: IncomingMessage): Promise<SessionView> {
    const context = this.contextOf(request);
    const cookie = readCookieToken(context.cookies.get(this.names.session));
    if (cookie !== null) {
      const view = await withBusiness(this.database.db, cookie.businessId, async (tx) => {
        const caller = await this.applyRules(tx, cookie);
        if (caller === null || caller === 'ended') return null;
        return this.viewOf(tx, caller, csrfTokenFor(cookie.token));
      });
      if (view !== null) return view;
    }
    const businessId = readCookieToken(context.cookies.get(this.names.device))?.businessId;
    if (businessId === undefined) return { state: 'none', device: null };
    const name = await withBusiness(this.database.db, businessId, async (tx) => {
      if ((await this.findDeviceIn(tx, businessId, context)) === null) return undefined;
      const [row] = await tx.select({ name: businesses.name }).from(businesses);
      return row?.name;
    });
    return { state: 'none', device: name === undefined ? null : { businessName: name } };
  }

  /** The owner's "Lock now" (#38). */
  async lock(caller: Caller): Promise<void> {
    await withBusiness(this.database.db, caller.businessId, async (tx) => {
      await this.lockIn(tx, caller, { manual: true });
    });
  }

  /** #21: unlocking needs the password; false when it's wrong. */
  async unlock(caller: Caller, password: string): Promise<boolean> {
    // Counted before the check, like a login (#41); the right password takes it back.
    throwUnless(this.limits.unlock.hit(caller.sessionId));
    const hash = await withBusiness(this.database.db, caller.businessId, async (tx) => {
      const [row] = await tx
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, caller.userId));
      return row?.passwordHash ?? null;
    });
    if (!(await this.checkPassword(password, hash))) return false;
    this.limits.unlock.reset(caller.sessionId);
    const now = this.clock.now();
    await withBusiness(this.database.db, caller.businessId, async (tx) => {
      const unlocked = await tx
        .update(sessions)
        .set({ lockedAt: null, lastActiveAt: now })
        .where(and(eq(sessions.id, caller.sessionId), isNull(sessions.endedAt)))
        .returning({ id: sessions.id });
      if (unlocked.length > 0) {
        await recordEntry(tx, {
          actorId: caller.userId,
          action: 'session.unlocked',
          entityType: 'session',
          entityId: caller.sessionId,
          branchId: caller.branchId,
        });
      }
    });
    return true;
  }

  /** Logs out: the session ends and the cookie goes (the device cookie stays, #40). */
  async logout(caller: Caller): Promise<string[]> {
    await withBusiness(this.database.db, caller.businessId, (tx) =>
      this.end(tx, caller.sessionId, caller.userId, caller.branchId, 'logout'),
    );
    return [this.clearSessionCookie()];
  }

  /** Expires the session cookie, e.g. after a session ended. */
  clearSessionCookie(): string {
    return serializeCookie(this.names.session, '', {
      secure: this.settings.cookieSecure,
      maxAge: 0,
    });
  }

  /** Expires the device cookie: this computer no longer knows its business (#44). */
  clearDeviceCookie(): string {
    return serializeCookie(this.names.device, '', {
      secure: this.settings.cookieSecure,
      maxAge: 0,
    });
  }

  /** The device row this computer's cookie names, if any (#44's "This computer"). */
  deviceTokenHashOf(context: RequestContext): string | null {
    const cookie = readCookieToken(context.cookies.get(this.names.device));
    return cookie === null ? null : hashToken(cookie.token);
  }

  /**
   * Section 6: sensitive routes take the owner's password in the body. Stateless, and counted
   * per session before the check, like a login; the right password takes the count back.
   */
  async requireOwnerPassword(caller: Caller, password: string): Promise<void> {
    await this.requirePassword(caller, password, eq(users.role, 'owner'));
  }

  /** #46: the caller's own current password, under the same limit. */
  async requireOwnPassword(caller: Caller, password: string): Promise<void> {
    await this.requirePassword(caller, password, eq(users.id, caller.userId));
  }

  /** A new password's hash, made in the one Argon2 queue outside any transaction. */
  hashNewPassword(password: string): Promise<string> {
    return this.gate.run(() => hashPassword(password));
  }

  /**
   * Sets a user's new password inside the caller's transaction and ends their sessions, all
   * of them or all but `keep` (#30, #31, #46). An emailed reset link still open stops working
   * too: it was asked for before this password, maybe by whoever this change locks out.
   */
  async setPasswordIn(
    tx: Transaction,
    userId: string,
    passwordHash: string,
    reason: 'reset' | 'password_changed',
    keep?: string,
  ): Promise<void> {
    await tx
      .update(users)
      .set({ passwordHash, passwordChangedAt: this.clock.now() })
      .where(eq(users.id, userId));
    await tx
      .update(authTokens)
      .set({ usedAt: this.clock.now() })
      .where(
        and(
          eq(authTokens.userId, userId),
          eq(authTokens.kind, 'reset_password'),
          isNull(authTokens.usedAt),
        ),
      );
    await this.endSessionsIn(tx, eq(sessions.userId, userId), reason, keep);
  }

  /** Ends every open session matching `where`, except `keep`, each with its log entry. */
  async endSessionsIn(
    tx: Transaction,
    where: SQL | undefined,
    reason: SessionEndReason,
    keep?: string,
  ): Promise<void> {
    const open = await tx
      .select({ id: sessions.id, userId: sessions.userId, branchId: sessions.branchId })
      .from(sessions)
      .where(and(where, isNull(sessions.endedAt)));
    for (const row of open) {
      if (row.id !== keep) await this.end(tx, row.id, row.userId, row.branchId, reason);
    }
  }

  // ---------------------------------------------------------------------------------------

  private async requirePassword(caller: Caller, password: string, who: SQL): Promise<void> {
    throwUnless(this.limits.ownerPassword.hit(caller.sessionId));
    const hash = await withBusiness(this.database.db, caller.businessId, async (tx) => {
      const [row] = await tx
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(and(who, isNull(users.deactivatedAt)));
      return row?.passwordHash ?? null;
    });
    if (!(await this.checkPassword(password, hash))) throw new WrongPasswordError();
    this.limits.ownerPassword.reset(caller.sessionId);
  }

  private async checkPassword(password: string, stored: string | null): Promise<boolean> {
    const hash = stored ?? (await this.standInHash());
    const ok = await this.gate.run(() => verifyPassword(password, hash));
    return ok && stored !== null;
  }

  /**
   * Made once and outside the queue, only when a login doesn't exist. A failure isn't kept, so
   * one bad moment can't break every later unknown-email login.
   */
  private standInHash(): Promise<string> {
    this.standIn ??= hashPassword(randomUUID()).catch((error: unknown) => {
      this.standIn = undefined;
      throw error;
    });
    return this.standIn;
  }

  /**
   * ADR 0035: a hash made with older parameters is replaced at the next login. The slow hash
   * runs here, outside any transaction; the returned step writes it inside the login's.
   */
  private async rehashIfOld(
    password: string,
    stored: string | null,
  ): Promise<((tx: Transaction, userId: string) => Promise<void>) | undefined> {
    if (stored === null || !needsRehash(stored)) return undefined;
    const passwordHash = await this.gate.run(() => hashPassword(password));
    return async (tx, userId) => {
      await tx.update(users).set({ passwordHash }).where(eq(users.id, userId));
    };
  }

  /** The live device row behind this computer's device cookie, if it belongs to `businessId`. */
  private async findDeviceIn(
    tx: Transaction,
    businessId: string,
    context: RequestContext,
  ): Promise<FoundDevice | null> {
    const cookie = readCookieToken(context.cookies.get(this.names.device));
    if (cookie?.businessId !== businessId) return null;
    const [found] = await tx
      .select({ id: devices.id, branchId: devices.branchId })
      .from(devices)
      .where(and(eq(devices.tokenHash, hashToken(cookie.token)), isNull(devices.revokedAt)));
    return found === undefined ? null : { ...found, cookie };
  }

  /**
   * One session per browser (#18): a new login ends the one the cookie held, in the same
   * transaction, even when that session belongs to another business.
   */
  private async endCookieSessionIn(tx: Transaction, businessId: string, context: RequestContext) {
    const cookie = readCookieToken(context.cookies.get(this.names.session));
    if (cookie === null) return;
    const endIt = async (inner: Transaction) => {
      const [row] = await inner
        .select({ id: sessions.id, userId: sessions.userId, branchId: sessions.branchId })
        .from(sessions)
        .where(and(eq(sessions.tokenHash, hashToken(cookie.token)), isNull(sessions.endedAt)));
      if (row !== undefined) await this.end(inner, row.id, row.userId, row.branchId, 'replaced');
    };
    await (cookie.businessId === businessId
      ? endIt(tx)
      : alsoInBusiness(tx, cookie.businessId, endIt));
  }

  /** Starts a session inside the caller's transaction, ending the browser's old one. */
  private async startIn(
    tx: Transaction,
    options: StartOptions,
    context: RequestContext,
  ): Promise<LoginResult> {
    const { businessId, userId } = options;
    await this.endCookieSessionIn(tx, businessId, context);
    const now = this.clock.now();
    let device = options.device;
    if (device === null) {
      // #37, #44: the owner's login registers this computer at the branch it is in (P1.6).
      const branchId = options.newDeviceBranchId;
      if (branchId === undefined) throw new Error('A new computer needs its branch');
      const token = newToken();
      const [row] = await tx
        .insert(devices)
        .values({
          businessId,
          branchId,
          tokenHash: hashToken(token),
          registeredBy: userId,
          lastSeenAt: now,
        })
        .returning({ id: devices.id });
      if (row === undefined) throw new Error('No device row returned');
      device = { id: row.id, branchId, cookie: { businessId, token } };
      await recordEntry(tx, {
        actorId: userId,
        action: 'device.registered',
        entityType: 'device',
        entityId: row.id,
        branchId,
      });
    } else {
      // Read back from the update: a computer moved at this very moment (a lock wait) answers
      // with its new branch, so this session starts where the computer now is.
      const [current] = await tx
        .update(devices)
        .set({ lastSeenAt: now })
        .where(eq(devices.id, device.id))
        .returning({ branchId: devices.branchId });
      if (current === undefined) throw new Error('Device not found');
      device = { ...device, branchId: current.branchId };
    }
    await this.requireUsableBranch(tx, userId, options.role, device.branchId);
    const token = newToken();
    const csrfToken = csrfTokenFor(token);
    const [session] = await tx
      .insert(sessions)
      .values({
        businessId,
        userId,
        branchId: device.branchId,
        deviceId: device.id,
        tokenHash: hashToken(token),
        csrfHash: hashToken(csrfToken),
        userAgent: context.userAgent,
        lastActiveAt: now,
      })
      .returning({ id: sessions.id });
    if (session === undefined) throw new Error('No session row returned');
    await recordEntry(tx, {
      actorId: userId,
      action: 'user.logged_in',
      entityType: 'session',
      entityId: session.id,
      branchId: device.branchId,
    });
    const caller = this.callerOf(
      {
        businessId,
        userId,
        sessionId: session.id,
        branchId: device.branchId,
        role: options.role,
        locked: false,
        csrfHash: hashToken(csrfToken),
      },
      await this.storedPermissionsIn(tx, userId),
    );
    const secure = this.settings.cookieSecure;
    const setCookies = [
      // No Max-Age: the session ends when Chrome closes (#40).
      serializeCookie(this.names.session, formatCookieToken({ businessId, token }), { secure }),
    ];
    if (options.role === 'owner') {
      // Renewed at each owner login (#44).
      setCookies.push(
        serializeCookie(this.names.device, formatCookieToken(device.cookie), {
          secure,
          maxAge: DEVICE_MAX_AGE_SECONDS,
        }),
      );
    }
    const view = await this.viewOf(tx, caller, csrfToken);
    return { setCookies, view: { ...view, state: 'active' } };
  }

  /**
   * Where a new computer goes (P1.6, `00` #54–#60): the business's only active branch, else
   * the one the owner chose. With several and no choice yet the login answers
   * `choose_branch`, and the owner sends it again with `branchId`.
   */
  private async branchForNewComputer(tx: Transaction, chosen?: string): Promise<string> {
    const active = await tx
      .select({ id: branches.id, code: branches.code, name: branches.name })
      .from(branches)
      .where(isNull(branches.archivedAt))
      .orderBy(asc(branches.createdAt), asc(branches.id));
    const first = active[0];
    if (first === undefined) throw new Error('Business has no active branch');
    if (chosen !== undefined) {
      if (!active.some((branch) => branch.id === chosen)) throw new InvalidBranchError();
      return chosen;
    }
    if (active.length > 1) throw new ChooseBranchError(active);
    return first.id;
  }

  /**
   * A session starts only at a live branch, and staff only where they may work (their home or
   * a branch the owner ticked). The branch row is locked FOR SHARE, so archiving it (which locks
   * it FOR UPDATE) and this login can't both slip past each other.
   */
  private async requireUsableBranch(
    tx: Transaction,
    userId: string,
    role: 'owner' | 'staff',
    branchId: string,
  ): Promise<void> {
    const [branch] = await tx
      .select({ name: branches.name, archivedAt: branches.archivedAt })
      .from(branches)
      .where(eq(branches.id, branchId))
      .for('share');
    if (branch === undefined) throw new Error('Branch not found');
    if (branch.archivedAt !== null) throw new NoDeviceError();
    if (role === 'staff') {
      const [user] = await tx
        .select({ homeBranchId: users.homeBranchId })
        .from(users)
        .where(eq(users.id, userId));
      if (!(await this.mayWorkAt(tx, userId, user?.homeBranchId ?? null, branchId))) {
        throw new WrongBranchError(branch.name);
      }
    }
  }

  /** A staff login works at its home branch and at the branches the owner ticked (#35). */
  private async mayWorkAt(
    tx: Transaction,
    userId: string,
    homeBranchId: string | null,
    branchId: string,
  ): Promise<boolean> {
    if (homeBranchId === branchId) return true;
    const [extra] = await tx
      .select({ id: staffBranches.id })
      .from(staffBranches)
      .where(and(eq(staffBranches.userId, userId), eq(staffBranches.branchId, branchId)));
    return extra !== undefined;
  }

  /** The lock and idle rules, applied to the session a cookie names. */
  private async applyRules(tx: Transaction, cookie: CookieToken): Promise<Caller | 'ended' | null> {
    const [row] = await tx
      .select({
        id: sessions.id,
        userId: sessions.userId,
        branchId: sessions.branchId,
        csrfHash: sessions.csrfHash,
        lastActiveAt: sessions.lastActiveAt,
        lockedAt: sessions.lockedAt,
        endedAt: sessions.endedAt,
        role: users.role,
        deactivatedAt: users.deactivatedAt,
        homeBranchId: users.homeBranchId,
        // Read on every request, so a change by the owner reaches a login that is already
        // open with nothing to invalidate (P1.5 design, section 5; ADR 0044).
        permissionsAdded: users.permissionsAdded,
        permissionsRemoved: users.permissionsRemoved,
        ownerLockMinutes: businesses.ownerLockMinutes,
        staffIdleMinutes: businesses.staffIdleMinutes,
      })
      .from(sessions)
      .innerJoin(
        users,
        and(eq(users.businessId, sessions.businessId), eq(users.id, sessions.userId)),
      )
      .innerJoin(businesses, eq(businesses.id, sessions.businessId))
      .where(eq(sessions.tokenHash, hashToken(cookie.token)));
    if (row?.endedAt !== null) return null;
    const role = row.role === 'owner' ? 'owner' : 'staff';
    // #34: a deactivated login's sessions end at once.
    if (row.deactivatedAt !== null) {
      await this.end(tx, row.id, row.userId, row.branchId, 'deactivated');
      return 'ended';
    }
    // Read on every request, like the permissions: unticking a branch, or moving the login's
    // home, ends the session at the next click (P1.6, ADR 0044's pattern).
    if (
      role === 'staff' &&
      !(await this.mayWorkAt(tx, row.userId, row.homeBranchId, row.branchId))
    ) {
      await this.end(tx, row.id, row.userId, row.branchId, 'branch_removed');
      return 'ended';
    }
    // The grace covers key presses since the web app's last "still here" (IDLE_GRACE_MS).
    const idleMs = this.clock.now().getTime() - row.lastActiveAt.getTime() - IDLE_GRACE_MS;
    if (role === 'staff' && idleMs > row.staffIdleMinutes * MINUTE) {
      await this.end(tx, row.id, row.userId, row.branchId, 'idle');
      return 'ended';
    }
    const caller = this.callerOf(
      {
        businessId: cookie.businessId,
        userId: row.userId,
        sessionId: row.id,
        branchId: row.branchId,
        role,
        locked: row.lockedAt !== null,
        csrfHash: row.csrfHash,
      },
      { added: row.permissionsAdded, removed: row.permissionsRemoved },
    );
    if (role === 'owner' && !caller.locked && idleMs > row.ownerLockMinutes * MINUTE) {
      await this.lockIn(tx, caller, { idleSince: row.lastActiveAt.toISOString() });
      return { ...caller, locked: true };
    }
    return caller;
  }

  /** The owner holds every permission; staff what the owner switched on for them (P1.5). */
  private callerOf(fields: Omit<Caller, 'permissions'>, stored: PermissionDifference): Caller {
    return {
      ...fields,
      permissions: fields.role === 'owner' ? PERMISSIONS : effectivePermissions(stored),
    };
  }

  private async storedPermissionsIn(
    tx: Transaction,
    userId: string,
  ): Promise<PermissionDifference> {
    const [row] = await tx
      .select({ added: users.permissionsAdded, removed: users.permissionsRemoved })
      .from(users)
      .where(eq(users.id, userId));
    if (row === undefined) throw new Error('Session user not found');
    return row;
  }

  private async activeBranchCountIn(tx: Transaction): Promise<number> {
    const [row] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(branches)
      .where(isNull(branches.archivedAt));
    return row?.count ?? 0;
  }

  private async lockIn(tx: Transaction, caller: Caller, after: Record<string, unknown>) {
    const locked = await tx
      .update(sessions)
      .set({ lockedAt: this.clock.now() })
      .where(
        and(eq(sessions.id, caller.sessionId), isNull(sessions.lockedAt), isNull(sessions.endedAt)),
      )
      .returning({ id: sessions.id });
    if (locked.length === 0) return;
    await recordEntry(tx, {
      actorId: caller.userId,
      action: 'session.locked',
      entityType: 'session',
      entityId: caller.sessionId,
      branchId: caller.branchId,
      after,
    });
  }

  private async end(
    tx: Transaction,
    sessionId: string,
    userId: string,
    branchId: string,
    reason: SessionEndReason,
  ): Promise<void> {
    const ended = await tx
      .update(sessions)
      .set({ endedAt: this.clock.now(), endReason: reason })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.endedAt)))
      .returning({ id: sessions.id });
    if (ended.length === 0) return;
    await recordEntry(tx, {
      actorId: userId,
      action: 'user.logged_out',
      entityType: 'session',
      entityId: sessionId,
      branchId,
      after: { cause: reason },
    });
  }

  private async viewOf(tx: Transaction, caller: Caller, csrfToken: string): Promise<ActiveSession> {
    const [row] = await tx
      .select({
        name: sql<string>`coalesce(${users.name}, ${users.email}, ${users.username})`,
        businessName: businesses.name,
        branchCode: branches.code,
        branchName: branches.name,
        ownerLockMinutes: businesses.ownerLockMinutes,
        staffIdleMinutes: businesses.staffIdleMinutes,
        emailConfirmedAt: users.emailConfirmedAt,
        storedDiscountLimit: users.discountLimitBasisPoints,
      })
      .from(users)
      .innerJoin(businesses, eq(businesses.id, users.businessId))
      .innerJoin(
        branches,
        and(eq(branches.businessId, users.businessId), eq(branches.id, caller.branchId)),
      )
      .where(eq(users.id, caller.userId));
    if (row === undefined) throw new Error('Session user not found');
    // A session with no remembered computer prints the defaults: 80 mm, printing at once.
    const [computer] = await tx
      .select({ receiptSize: devices.receiptSize, autoPrint: devices.autoPrint })
      .from(sessions)
      .innerJoin(
        devices,
        and(eq(devices.businessId, sessions.businessId), eq(devices.id, sessions.deviceId)),
      )
      .where(eq(sessions.id, caller.sessionId));
    return {
      state: caller.locked ? 'locked' : 'active',
      user: { id: caller.userId, role: caller.role, name: row.name },
      business: { id: caller.businessId, name: row.businessName },
      branch: { id: caller.branchId, code: row.branchCode, name: row.branchName },
      ...(caller.role === 'owner' && { branchCount: await this.activeBranchCountIn(tx) }),
      csrfToken,
      idleMinutes: caller.role === 'owner' ? row.ownerLockMinutes : row.staffIdleMinutes,
      // Staff have no email: nothing for them to confirm (#32).
      emailConfirmed: caller.role === 'staff' || row.emailConfirmedAt !== null,
      emailLimited: this.settings.emailLimited,
      discountLimitBasisPoints: effectiveDiscountLimit(
        caller.role,
        caller.permissions,
        row.storedDiscountLimit,
      ),
      permissions: [...caller.permissions],
      printing: {
        receiptSize: (computer?.receiptSize ?? 80) as ReceiptSize,
        autoPrint: computer?.autoPrint ?? true,
      },
    };
  }
}
