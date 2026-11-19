// Logins and sessions (ADR 0009; P1.4 design, sections 3–7; Module 00 #21, #27–#29, #34,
// #37–#41). Every lookup after login-by-email runs under RLS for the business in the cookie.
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
  withBusiness,
  type Database,
  type SessionEndReason,
  type Transaction,
} from '@business-software/db';
import { PERMISSIONS, type ActiveSession, type SessionView } from '@business-software/shared';
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
import { HashGate } from './hash-gate.js';
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
/** `last_active_at` is written at most this often, not on every request. */
const ACTIVITY_WRITE_MS = 15_000;

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

/** Rate limits (Module 00 #41; P1.4 design, section 7). */
export class LoginLimits {
  /** Attempts per computer (IP address). */
  readonly ip: RateLimiter;
  /** Wrong passwords per login. */
  readonly failures: RateLimiter;
  readonly signup: RateLimiter;
  /** Wrong unlock passwords per session. */
  readonly unlock: RateLimiter;

  constructor(clock: Clock) {
    this.ip = new RateLimiter(30, 15 * MINUTE, clock);
    this.failures = new RateLimiter(10, 15 * MINUTE, clock);
    this.signup = new RateLimiter(5, 60 * MINUTE, clock);
    this.unlock = new RateLimiter(10, 15 * MINUTE, clock);
  }
}

export interface RequestContext {
  ip: string;
  userAgent: string | undefined;
  cookies: Map<string, string>;
}

export interface LoginResult {
  setCookies: string[];
  view: ActiveSession;
}

interface StartOptions {
  businessId: string;
  userId: string;
  role: 'owner' | 'staff';
  /** The computer's device row, or none: an owner login registers the computer (#37). */
  device: { id: string; branchId: string; cookie: CookieToken } | null;
}

function throwUnless(verdict: Verdict): void {
  if (!verdict.allowed) throw new TooManyAttemptsError(verdict.retryAt);
}

export interface AuthSettings {
  cookieSecure: boolean;
}

export class SessionService {
  private readonly names: CookieNames;
  private readonly gate = new HashGate();
  // Checked against when the login doesn't exist, so the answer takes as long (section 5).
  private dummyHash: Promise<string> | undefined;

  constructor(
    private readonly database: Database,
    private readonly settings: AuthSettings,
    private readonly clock: Clock,
    readonly limits: LoginLimits,
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

  /** Module 00 #27: email and password. */
  async loginOwner(email: string, password: string, context: RequestContext): Promise<LoginResult> {
    throwUnless(this.limits.ip.hit(context.ip));
    const loginKey = `owner:${email}`;
    throwUnless(this.limits.failures.check(loginKey));
    const { rows } = await this.database.db.execute<{ business_id: string; user_id: string }>(
      sql`select business_id, user_id from app_find_owner_login(${email})`,
    );
    const found = rows[0];
    const user =
      found === undefined
        ? undefined
        : await withBusiness(this.database.db, found.business_id, async (tx) => {
            const [row] = await tx
              .select({ passwordHash: users.passwordHash, deactivatedAt: users.deactivatedAt })
              .from(users)
              .where(eq(users.id, found.user_id));
            return row;
          });
    const ok = await this.checkPassword(password, user?.passwordHash ?? null);
    if (!ok || found === undefined || user?.deactivatedAt !== null) {
      this.limits.failures.hit(loginKey);
      throw new WrongLoginError();
    }
    this.limits.failures.reset(loginKey);
    await this.rehashIfOld(found.business_id, found.user_id, password, user.passwordHash);
    await this.endCookieSession(context, 'replaced');
    const device = await this.findDevice(context);
    return this.start(
      {
        businessId: found.business_id,
        userId: found.user_id,
        role: 'owner',
        device: device?.cookie.businessId === found.business_id ? device : null,
      },
      context,
    );
  }

  /** Module 00 #28: username and password, on a computer that knows its business. */
  async loginStaff(username: string, password: string, context: RequestContext) {
    throwUnless(this.limits.ip.hit(context.ip));
    const device = await this.findDevice(context);
    if (device === null) throw new NoDeviceError();
    const { businessId } = device.cookie;
    const loginKey = `staff:${businessId}:${username}`;
    throwUnless(this.limits.failures.check(loginKey));
    const user = await withBusiness(this.database.db, businessId, async (tx) => {
      const [row] = await tx
        .select({
          id: users.id,
          passwordHash: users.passwordHash,
          deactivatedAt: users.deactivatedAt,
        })
        .from(users)
        .where(and(eq(users.username, username), eq(users.role, 'staff')));
      return row;
    });
    const ok = await this.checkPassword(password, user?.passwordHash ?? null);
    if (!ok || user?.deactivatedAt !== null) {
      this.limits.failures.hit(loginKey);
      throw new WrongLoginError();
    }
    this.limits.failures.reset(loginKey);
    await this.rehashIfOld(businessId, user.id, password, user.passwordHash);
    await this.endCookieSession(context, 'replaced');
    return this.start({ businessId, userId: user.id, role: 'staff', device }, context);
  }

  /**
   * Signup's last step, inside its transaction (Module 00 #37): the owner is logged in and the
   * computer becomes the business's counter.
   */
  async startInTransaction(
    tx: Transaction,
    businessId: string,
    userId: string,
    context: RequestContext,
  ): Promise<string[]> {
    const { setCookies } = await this.startIn(
      tx,
      { businessId, userId, role: 'owner', device: null },
      context,
    );
    return setCookies;
  }

  /** Who is calling, applying the lock and idle rules (Module 00 #21, #29, #34). */
  async resolve(request: IncomingMessage, passive: boolean): Promise<Caller | null> {
    const cookie = readCookieToken(this.contextOf(request).cookies.get(this.names.session));
    if (cookie === null) return null;
    const outcome = await withBusiness(this.database.db, cookie.businessId, (tx) =>
      this.applyRules(tx, cookie, passive),
    );
    if (outcome === 'ended') throw new SessionEndedError();
    return outcome;
  }

  /** `GET /api/session` (passive): the session, or which business this computer remembers. */
  async view(request: IncomingMessage): Promise<SessionView> {
    const context = this.contextOf(request);
    const cookie = readCookieToken(context.cookies.get(this.names.session));
    if (cookie !== null) {
      const view = await withBusiness(this.database.db, cookie.businessId, async (tx) => {
        const caller = await this.applyRules(tx, cookie, true);
        if (caller === null || caller === 'ended') return null;
        return this.viewOf(tx, caller, csrfTokenFor(cookie.token));
      });
      if (view !== null) return view;
    }
    const device = await this.findDevice(context);
    if (device === null) return { state: 'none', device: null };
    const name = await withBusiness(this.database.db, device.cookie.businessId, async (tx) => {
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
    throwUnless(this.limits.unlock.check(caller.sessionId));
    const hash = await withBusiness(this.database.db, caller.businessId, async (tx) => {
      const [row] = await tx
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, caller.userId));
      return row?.passwordHash ?? null;
    });
    if (!(await this.checkPassword(password, hash))) {
      this.limits.unlock.hit(caller.sessionId);
      return false;
    }
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

  // ---------------------------------------------------------------------------------------

  private async checkPassword(password: string, stored: string | null): Promise<boolean> {
    this.dummyHash ??= this.gate.run(() => hashPassword(randomUUID()));
    const hash = stored ?? (await this.dummyHash);
    const ok = await this.gate.run(() => verifyPassword(password, hash));
    return ok && stored !== null;
  }

  /** ADR 0035: a hash made with older parameters is replaced at the next login. */
  private async rehashIfOld(
    businessId: string,
    userId: string,
    password: string,
    stored: string | null,
  ): Promise<void> {
    if (stored === null || !needsRehash(stored)) return;
    const passwordHash = await this.gate.run(() => hashPassword(password));
    await withBusiness(this.database.db, businessId, (tx) =>
      tx.update(users).set({ passwordHash }).where(eq(users.id, userId)),
    );
  }

  /** The live device row behind this computer's device cookie, or null. */
  private async findDevice(context: RequestContext) {
    const cookie = readCookieToken(context.cookies.get(this.names.device));
    if (cookie === null) return null;
    const row = await withBusiness(this.database.db, cookie.businessId, async (tx) => {
      const [found] = await tx
        .select({ id: devices.id, branchId: devices.branchId })
        .from(devices)
        .where(and(eq(devices.tokenHash, hashToken(cookie.token)), isNull(devices.revokedAt)));
      return found;
    });
    return row === undefined ? null : { ...row, cookie };
  }

  /** One session per browser (#18): a new login ends the one the cookie held. */
  private async endCookieSession(context: RequestContext, reason: SessionEndReason) {
    const cookie = readCookieToken(context.cookies.get(this.names.session));
    if (cookie === null) return;
    await withBusiness(this.database.db, cookie.businessId, async (tx) => {
      const [row] = await tx
        .select({ id: sessions.id, userId: sessions.userId, branchId: sessions.branchId })
        .from(sessions)
        .where(and(eq(sessions.tokenHash, hashToken(cookie.token)), isNull(sessions.endedAt)));
      if (row !== undefined) await this.end(tx, row.id, row.userId, row.branchId, reason);
    });
  }

  private start(options: StartOptions, context: RequestContext): Promise<LoginResult> {
    return withBusiness(this.database.db, options.businessId, (tx) =>
      this.startIn(tx, options, context),
    );
  }

  private async startIn(
    tx: Transaction,
    options: StartOptions,
    context: RequestContext,
  ): Promise<LoginResult> {
    const { businessId, userId } = options;
    const now = this.clock.now();
    let device = options.device;
    if (device === null) {
      // #37, #44: the owner's login registers this computer, on the first branch until P1.6.
      const [branch] = await tx
        .select({ id: branches.id })
        .from(branches)
        .orderBy(asc(branches.createdAt), asc(branches.id))
        .limit(1);
      if (branch === undefined) throw new Error('Business has no branch');
      const token = newToken();
      const [row] = await tx
        .insert(devices)
        .values({
          businessId,
          branchId: branch.id,
          tokenHash: hashToken(token),
          registeredBy: userId,
          lastSeenAt: now,
        })
        .returning({ id: devices.id });
      if (row === undefined) throw new Error('No device row returned');
      device = { id: row.id, branchId: branch.id, cookie: { businessId, token } };
      await recordEntry(tx, {
        actorId: userId,
        action: 'device.registered',
        entityType: 'device',
        entityId: row.id,
        branchId: branch.id,
      });
    } else {
      await tx.update(devices).set({ lastSeenAt: now }).where(eq(devices.id, device.id));
    }
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
    const caller = this.callerOf({
      businessId,
      userId,
      sessionId: session.id,
      branchId: device.branchId,
      role: options.role,
      locked: false,
      csrfHash: hashToken(csrfToken),
    });
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

  /** The lock and idle rules, applied to the session a cookie names. */
  private async applyRules(
    tx: Transaction,
    cookie: CookieToken,
    passive: boolean,
  ): Promise<Caller | 'ended' | null> {
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
    const now = this.clock.now();
    const idleMs = now.getTime() - row.lastActiveAt.getTime();
    if (role === 'staff' && idleMs > row.staffIdleMinutes * MINUTE) {
      await this.end(tx, row.id, row.userId, row.branchId, 'idle');
      return 'ended';
    }
    const caller = this.callerOf({
      businessId: cookie.businessId,
      userId: row.userId,
      sessionId: row.id,
      branchId: row.branchId,
      role,
      locked: row.lockedAt !== null,
      csrfHash: row.csrfHash,
    });
    if (role === 'owner' && !caller.locked && idleMs > row.ownerLockMinutes * MINUTE) {
      await this.lockIn(tx, caller, { idleSince: row.lastActiveAt.toISOString() });
      return { ...caller, locked: true };
    }
    if (!caller.locked && !passive && idleMs > ACTIVITY_WRITE_MS) {
      await tx.update(sessions).set({ lastActiveAt: now }).where(eq(sessions.id, row.id));
    }
    return caller;
  }

  private callerOf(fields: Omit<Caller, 'permissions'>): Caller {
    // The owner holds every permission; staff only their own session until P1.5.
    return { ...fields, permissions: fields.role === 'owner' ? PERMISSIONS : ['session.own'] };
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
        branchName: branches.name,
        ownerLockMinutes: businesses.ownerLockMinutes,
        staffIdleMinutes: businesses.staffIdleMinutes,
      })
      .from(users)
      .innerJoin(businesses, eq(businesses.id, users.businessId))
      .innerJoin(
        branches,
        and(eq(branches.businessId, users.businessId), eq(branches.id, caller.branchId)),
      )
      .where(eq(users.id, caller.userId));
    if (row === undefined) throw new Error('Session user not found');
    return {
      state: caller.locked ? 'locked' : 'active',
      user: { id: caller.userId, role: caller.role, name: row.name },
      business: { id: caller.businessId, name: row.businessName },
      branch: { id: caller.branchId, name: row.branchName },
      csrfToken,
      idleMinutes: caller.role === 'owner' ? row.ownerLockMinutes : row.staffIdleMinutes,
    };
  }
}
