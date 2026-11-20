// Account recovery and your own password (Module 00 #30-#32, #46; P1.4 design, sections 6,
// 7, 10). Slow password hashes run outside transactions, in the one Argon2 queue; each change
// and its log entry commit together, and emails go out after the commit.
import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  businesses,
  eq,
  isNotNull,
  isNull,
  recordEntry,
  recoveryKeys,
  users,
  withBusiness,
  type Database,
  type Transaction,
} from '@business-software/db';
import { passwordProblem } from '@business-software/shared';
import { CLOCK, type Clock } from '../auth/clock.js';
import {
  SESSION_SERVICE,
  throwUnless,
  type RequestContext,
  type SessionService,
} from '../auth/session.service.js';
import { DATABASE } from '../database.module.js';
import type { Caller } from '../http/session.js';
import { hashRecoveryKey, makeRecoveryKey } from '../signup/recovery-key.js';
import {
  AlreadyConfirmedError,
  InvalidLinkError,
  WeakPasswordError,
  WrongRecoveryKeyError,
} from './account.errors.js';
import { EMAIL_LINKS, lockUserIn, type EmailLinks } from './email-links.js';

interface Account {
  email: string | null;
  phone: string;
}

/** The email and business phone a new password may not be (Module 00 #7). */
async function accountOf(tx: Transaction, userId: string): Promise<Account> {
  const [row] = await tx
    .select({ email: users.email, phone: businesses.phone })
    .from(users)
    .innerJoin(businesses, eq(businesses.id, users.businessId))
    .where(eq(users.id, userId));
  if (row === undefined) throw new Error('User not found');
  return row;
}

function refuseWeak(password: string, account: Account): void {
  const problem = passwordProblem(password, account);
  if (problem !== null) throw new WeakPasswordError(problem);
}

@Injectable()
export class AccountService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
    @Inject(EMAIL_LINKS) private readonly links: EmailLinks,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** #32's "Send again": a new confirmation link replaces the old one. Owners only. */
  async sendConfirmation(caller: Caller): Promise<void> {
    throwUnless(this.sessions.limits.recoveryByAccount.hit(`confirm:${caller.userId}`));
    const sent = await withBusiness(this.database.db, caller.businessId, async (tx) => {
      const [user] = await tx
        .select({ email: users.email, confirmedAt: users.emailConfirmedAt })
        .from(users)
        .where(eq(users.id, caller.userId));
      if (user?.email == null) throw new Error('Owner has no email');
      if (user.confirmedAt !== null) throw new AlreadyConfirmedError();
      const token = await this.links.issueIn(tx, caller.businessId, caller.userId, 'confirm_email');
      return { email: user.email, token };
    });
    void this.links.send(sent.email, caller.businessId, 'confirm_email', sent.token);
  }

  /** #32: the link from the email. Public: it may be opened on a phone. */
  async confirmEmail(businessId: string, token: string, context: RequestContext): Promise<void> {
    throwUnless(this.sessions.limits.ip.hit(context.ip));
    await withBusiness(this.database.db, businessId, async (tx) => {
      const userId = await this.links.useIn(tx, 'confirm_email', token);
      if (userId === null) throw new InvalidLinkError();
      const confirmed = await tx
        .update(users)
        .set({ emailConfirmedAt: this.clock.now() })
        .where(and(eq(users.id, userId), isNull(users.emailConfirmedAt)))
        .returning({ id: users.id });
      if (confirmed.length === 0) return;
      await recordEntry(tx, {
        actorId: userId,
        action: 'user.email_confirmed',
        entityType: 'user',
        entityId: userId,
      });
    });
  }

  /**
   * #30: a reset link, only to a confirmed owner email. The caller always answers 202, so the
   * answer doesn't say whether the email has an account; both limits count every request.
   */
  async requestReset(email: string, context: RequestContext): Promise<void> {
    throwUnless(this.sessions.limits.recoveryByIp.hit(context.ip));
    throwUnless(this.sessions.limits.recoveryByAccount.hit(`reset:${email}`));
    const found = await this.sessions.findOwnerLogin(email);
    if (found === undefined) return;
    const token = await withBusiness(this.database.db, found.businessId, async (tx) => {
      const [user] = await tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.id, found.userId),
            isNotNull(users.emailConfirmedAt),
            isNull(users.deactivatedAt),
          ),
        );
      if (user === undefined) return null;
      return this.links.issueIn(tx, found.businessId, user.id, 'reset_password');
    });
    if (token !== null) void this.links.send(email, found.businessId, 'reset_password', token);
  }

  /**
   * #30: the new password from the reset page. The link is checked first, then the password,
   * so a refused password leaves the link working for another try. Every session of the owner
   * ends: whoever had the old password is out.
   */
  async completeReset(
    businessId: string,
    token: string,
    newPassword: string,
    context: RequestContext,
  ): Promise<void> {
    throwUnless(this.sessions.limits.ip.hit(context.ip));
    const account = await withBusiness(this.database.db, businessId, async (tx) => {
      const userId = await this.links.peekIn(tx, 'reset_password', token);
      return userId === null ? null : accountOf(tx, userId);
    });
    if (account === null) throw new InvalidLinkError();
    refuseWeak(newPassword, account);
    const passwordHash = await this.sessions.hashNewPassword(newPassword);
    await withBusiness(this.database.db, businessId, async (tx) => {
      const userId = await this.links.useIn(tx, 'reset_password', token);
      if (userId === null) throw new InvalidLinkError();
      await this.sessions.setPasswordIn(tx, userId, passwordHash, 'reset');
      await this.logReset(tx, userId, 'email');
    });
    if (account.email !== null) this.sessions.limits.failures.reset(`owner:${account.email}`);
  }

  /**
   * #31: the recovery key resets the password, stops working, and a new key is answered once.
   * Its own limit, separate from the login's: 5 per IP an hour, and none per email (owner,
   * 2026-11-20; #41): the key has 160 random bits, so a per-email limit couldn't stop a guess
   * that has no chance anyway, but would let anyone who knows the email lock the owner out.
   */
  async resetWithRecoveryKey(
    email: string,
    typedKey: string,
    newPassword: string,
    context: RequestContext,
  ): Promise<string> {
    throwUnless(this.sessions.limits.recoveryByIp.hit(context.ip));
    const keyHash = hashRecoveryKey(typedKey);
    const found = await this.sessions.findOwnerLogin(email);
    if (keyHash === null || found === undefined) throw new WrongRecoveryKeyError();
    const businessId = found.businessId;
    const userId = found.userId;
    const unusedKey = and(
      eq(recoveryKeys.userId, userId),
      eq(recoveryKeys.keyHash, keyHash),
      isNull(recoveryKeys.usedAt),
    );
    const account = await withBusiness(this.database.db, businessId, async (tx) => {
      const [key] = await tx.select({ id: recoveryKeys.id }).from(recoveryKeys).where(unusedKey);
      return key === undefined ? null : accountOf(tx, userId);
    });
    if (account === null) throw new WrongRecoveryKeyError();
    refuseWeak(newPassword, account);
    const passwordHash = await this.sessions.hashNewPassword(newPassword);
    const next = makeRecoveryKey();
    await withBusiness(this.database.db, businessId, async (tx) => {
      await lockUserIn(tx, userId);
      const used = await tx
        .update(recoveryKeys)
        .set({ usedAt: this.clock.now() })
        .where(unusedKey)
        .returning({ id: recoveryKeys.id });
      if (used.length === 0) throw new WrongRecoveryKeyError();
      await tx.insert(recoveryKeys).values({ businessId, userId, keyHash: next.hash });
      await this.sessions.setPasswordIn(tx, userId, passwordHash, 'reset');
      await this.logReset(tx, userId, 'recovery_key');
    });
    this.sessions.limits.failures.reset(`owner:${email}`);
    return next.key;
  }

  /** "Make a new recovery key" (needs the owner's password, section 6). Owners only. */
  async newRecoveryKey(caller: Caller, ownerPassword: string): Promise<string> {
    await this.sessions.requireOwnerPassword(caller, ownerPassword);
    const next = makeRecoveryKey();
    await withBusiness(this.database.db, caller.businessId, async (tx) => {
      await lockUserIn(tx, caller.userId);
      await tx
        .update(recoveryKeys)
        .set({ usedAt: this.clock.now() })
        .where(and(eq(recoveryKeys.userId, caller.userId), isNull(recoveryKeys.usedAt)));
      const [row] = await tx
        .insert(recoveryKeys)
        .values({ businessId: caller.businessId, userId: caller.userId, keyHash: next.hash })
        .returning({ id: recoveryKeys.id });
      if (row === undefined) throw new Error('No recovery key row returned');
      await recordEntry(tx, {
        actorId: caller.userId,
        action: 'recovery_key.replaced',
        entityType: 'recovery_key',
        entityId: row.id,
        branchId: caller.branchId,
      });
    });
    return next.key;
  }

  /** #46: needs the current password; every other session of this login ends. */
  async changePassword(caller: Caller, currentPassword: string, newPassword: string) {
    await this.sessions.requireOwnPassword(caller, currentPassword);
    const account = await withBusiness(this.database.db, caller.businessId, (tx) =>
      accountOf(tx, caller.userId),
    );
    refuseWeak(newPassword, account);
    const passwordHash = await this.sessions.hashNewPassword(newPassword);
    await withBusiness(this.database.db, caller.businessId, async (tx) => {
      await this.sessions.setPasswordIn(
        tx,
        caller.userId,
        passwordHash,
        'password_changed',
        caller.sessionId,
      );
      await recordEntry(tx, {
        actorId: caller.userId,
        action: 'user.password_changed',
        entityType: 'user',
        entityId: caller.userId,
        branchId: caller.branchId,
      });
    });
  }

  // ---------------------------------------------------------------------------------------

  private async logReset(tx: Transaction, userId: string, via: 'email' | 'recovery_key') {
    await recordEntry(tx, {
      actorId: userId,
      action: 'user.password_reset',
      entityType: 'user',
      entityId: userId,
      after: { via },
    });
  }
}
