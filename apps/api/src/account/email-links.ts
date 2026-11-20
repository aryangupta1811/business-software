// One-time links sent by email (Module 00 #30, #32, #42; P1.4 design, section 10). The link
// carries `<businessId>/<token>`, so the lookup runs under RLS for that business; only the
// token's SHA-256 is stored. Opening a link never uses it: the page POSTs the token.
import {
  and,
  authTokens,
  eq,
  gt,
  isNull,
  users,
  type AuthTokenKind,
  type Transaction,
} from '@business-software/db';
import type { Clock } from '../auth/clock.js';
import { hashToken, newToken } from '../auth/tokens.js';
import { sendAfterCommit, type MailLog, type Mailer } from '../mail/mailer.js';
import { confirmEmailMessage, resetPasswordMessage } from '../mail/messages.js';

/**
 * Locks the user's row until the transaction ends, so two requests that replace this user's
 * one open link or unused recovery key run one after the other. Without it, both mark the old
 * one used, both insert, and the second insert fails the partial unique index (a 500).
 */
export async function lockUserIn(tx: Transaction, userId: string): Promise<void> {
  await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
}

/** Injection token for the one EmailLinks. */
export const EMAIL_LINKS = 'EMAIL_LINKS';

const MINUTE = 60_000;

/** #42: a reset link works for 30 minutes, a confirmation link for 7 days. */
const LIFETIME_MS: Record<AuthTokenKind, number> = {
  confirm_email: 7 * 24 * 60 * MINUTE,
  reset_password: 30 * MINUTE,
};

const PATHS: Record<AuthTokenKind, string> = {
  confirm_email: 'confirm-email',
  reset_password: 'reset',
};

export class EmailLinks {
  constructor(
    private readonly mailer: Mailer,
    private readonly clock: Clock,
    /** The web app's address, without a trailing slash. */
    private readonly appUrl: string,
    private readonly log: MailLog,
  ) {}

  /**
   * A new token inside the caller's transaction. Any open one of the same kind is marked used
   * first, so one link works at a time (the database's partial unique index insists).
   */
  async issueIn(
    tx: Transaction,
    businessId: string,
    userId: string,
    kind: AuthTokenKind,
  ): Promise<string> {
    await lockUserIn(tx, userId);
    const now = this.clock.now();
    await tx
      .update(authTokens)
      .set({ usedAt: now })
      .where(
        and(eq(authTokens.userId, userId), eq(authTokens.kind, kind), isNull(authTokens.usedAt)),
      );
    const token = newToken();
    await tx.insert(authTokens).values({
      businessId,
      userId,
      kind,
      tokenHash: hashToken(token),
      createdAt: now,
      expiresAt: new Date(now.getTime() + LIFETIME_MS[kind]),
    });
    return token;
  }

  /** The user an open, unexpired token belongs to, without using it; or null. */
  async peekIn(tx: Transaction, kind: AuthTokenKind, token: string): Promise<string | null> {
    const [row] = await tx
      .select({ userId: authTokens.userId })
      .from(authTokens)
      .where(this.usable(kind, token));
    return row?.userId ?? null;
  }

  /**
   * Uses the token: marks it used and answers its user, or null if it was already used,
   * replaced or expired. One UPDATE, so two clicks at once can't both use it.
   */
  async useIn(tx: Transaction, kind: AuthTokenKind, token: string): Promise<string | null> {
    const [row] = await tx
      .update(authTokens)
      .set({ usedAt: this.clock.now() })
      .where(this.usable(kind, token))
      .returning({ userId: authTokens.userId });
    return row?.userId ?? null;
  }

  /**
   * Sends the link after the transaction has committed. Not awaited by callers: a slow mail
   * server mustn't slow the answer, or show by its timing whether an email has an account.
   */
  send(to: string, businessId: string, kind: AuthTokenKind, token: string): Promise<void> {
    const link = `${this.appUrl}/${PATHS[kind]}/${businessId}/${token}`;
    return kind === 'confirm_email'
      ? sendAfterCommit(this.mailer, this.log, 'confirmation', confirmEmailMessage(to, link))
      : sendAfterCommit(this.mailer, this.log, 'password reset', resetPasswordMessage(to, link));
  }

  private usable(kind: AuthTokenKind, token: string) {
    return and(
      eq(authTokens.tokenHash, hashToken(token)),
      eq(authTokens.kind, kind),
      isNull(authTokens.usedAt),
      gt(authTokens.expiresAt, this.clock.now()),
    );
  }
}
