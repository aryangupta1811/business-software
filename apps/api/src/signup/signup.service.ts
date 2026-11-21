import { Inject, Injectable } from '@nestjs/common';
import {
  branches,
  businesses,
  recordEntry,
  recoveryKeys,
  sql,
  users,
  withNewBusiness,
  type Database,
} from '@business-software/db';
import { FEATURE_PRESETS, type SignupInput, type SignupResult } from '@business-software/shared';
import { HASH_GATE, type HashGate } from '../auth/hash-gate.js';
import { hashPassword } from '../auth/password.js';
import {
  SESSION_SERVICE,
  type RequestContext,
  type SessionService,
} from '../auth/session.service.js';
import { DATABASE } from '../database.module.js';
import { EMAIL_LINKS, type EmailLinks } from '../account/email-links.js';
import { makeRecoveryKey } from './recovery-key.js';

/** The owner's email already has an account (Module 00 #27). */
export class EmailTakenError extends Error {
  constructor() {
    super('Email already has an owner account');
  }
}

// Drizzle wraps driver errors; PostgreSQL's code and constraint are on `cause`.
function isOwnerEmailTaken(error: unknown): boolean {
  const cause =
    error instanceof Error ? (error.cause as Record<string, unknown> | undefined) : undefined;
  return cause?.code === '23505' && cause.constraint === 'users_owner_email_unique';
}

@Injectable()
export class SignupService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
    @Inject(HASH_GATE) private readonly gate: HashGate,
    @Inject(EMAIL_LINKS) private readonly links: EmailLinks,
  ) {}

  /**
   * One transaction: the business, its first branch, the owner, an unused recovery key and
   * the `business.created` log entry, or none of them (ADR 0007). The unique index on owner
   * emails refuses a duplicate even across businesses, so no cross-business read is needed.
   * The owner is logged in, this computer becomes the business's counter, and the browser's
   * old session, if any, ends as replaced (Module 00 #18, #37).
   */
  async signUp(
    input: SignupInput,
    context: RequestContext,
  ): Promise<SignupResult & { setCookies: string[] }> {
    // Hashed first, so the slow hash never holds a database connection, and in the one
    // Argon2 queue, so a burst of signups can't run the server out of memory (ADR 0038).
    const passwordHash = await this.gate.run(() => hashPassword(input.password));
    const recoveryKey = makeRecoveryKey();
    const features = [...FEATURE_PRESETS[input.businessType]];
    try {
      const created = await withNewBusiness(this.database.db, async (tx, businessId) => {
        await tx.insert(businesses).values({
          id: businessId,
          name: input.businessName,
          businessType: input.businessType,
          phone: input.phone,
          gstStatus: input.gstStatus,
          features,
        });
        // The first branch is named after the business; the owner can rename it (P1.3 spec).
        await tx
          .insert(branches)
          .values({ businessId, name: input.businessName, code: 'HO', stateCode: input.stateCode });
        const [owner] = await tx
          .insert(users)
          .values({ businessId, role: 'owner', email: input.email, passwordHash })
          .returning({ id: users.id });
        if (owner === undefined) throw new Error('No owner row returned');
        await tx
          .insert(recoveryKeys)
          .values({ businessId, userId: owner.id, keyHash: recoveryKey.hash });
        await recordEntry(tx, {
          actorId: owner.id,
          action: 'business.created',
          entityType: 'business',
          entityId: businessId,
          after: {
            businessName: input.businessName,
            businessType: input.businessType,
            phone: input.phone,
            stateCode: input.stateCode,
            gstStatus: input.gstStatus,
            email: input.email,
            features,
          },
        });
        // Login by email finds this business from now on (P1.4 design, section 3).
        await tx.execute(sql`select app_register_owner_login(${owner.id})`);
        const setCookies = await this.sessions.startInTransaction(
          tx,
          businessId,
          owner.id,
          context,
        );
        // #32: confirming the email comes after signup; the link goes out after the commit.
        const confirmToken = await this.links.issueIn(tx, businessId, owner.id, 'confirm_email');
        return { businessId, setCookies, confirmToken };
      });
      void this.links.send(input.email, created.businessId, 'confirm_email', created.confirmToken);
      return {
        businessId: created.businessId,
        setCookies: created.setCookies,
        recoveryKey: recoveryKey.key,
      };
    } catch (error) {
      if (isOwnerEmailTaken(error)) throw new EmailTakenError();
      throw error;
    }
  }
}
