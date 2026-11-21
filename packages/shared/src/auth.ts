// Login, recovery and password request schemas and the session view (Module 00 #27-#33, #43,
// #46; P1.4 design). Error messages are codes the web app translates (ADR 0036).
import { z } from 'zod';
import type { Permission } from './business.js';
import { email, normalizePhone, text } from './fields.js';

/** A password exactly as typed: never trimmed (ADR 0035). */
const typedPassword = () =>
  z.string({ error: 'required' }).min(1, { error: 'required' }).max(128, { error: 'too_long' });

/** #43: 3 to 32 letters, digits, dots, dashes or underscores; not case-sensitive. */
export const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;

export const username = () =>
  z
    .string({ error: 'required' })
    .trim()
    .toLowerCase()
    .min(1, { error: 'required' })
    .regex(USERNAME_PATTERN, { error: 'invalid' });

/** #27: the owner logs in with email and password. */
export const ownerLoginSchema = z.strictObject({ email: email(), password: typedPassword() });
export type OwnerLoginInput = z.infer<typeof ownerLoginSchema>;

/** #28: staff log in with username and password on a computer that knows its business. */
export const staffLoginSchema = z.strictObject({
  username: username(),
  password: typedPassword(),
});
export type StaffLoginInput = z.infer<typeof staffLoginSchema>;

/** A new password (Module 00 #7, ADR 0035): never trimmed, at least 10 characters, no forced symbols. */
export const newPassword = () =>
  z
    .string({ error: 'required' })
    .min(1, { error: 'required' })
    .min(10, { error: 'too_short' })
    .max(128, { error: 'too_long' });

/** Module 00 #7: a password can't be the account's email or the business's phone number. */
export function passwordProblem(
  password: string,
  account: { email: string | null; phone: string },
): 'same_as_email' | 'same_as_phone' | null {
  if (account.email !== null && password.trim().toLowerCase() === account.email) {
    return 'same_as_email';
  }
  return normalizePhone(password) === account.phone ? 'same_as_phone' : null;
}

/** A link's token: 32 random bytes in base64url (P1.4 design, section 4). */
const linkToken = () =>
  z.string({ error: 'required' }).regex(/^[A-Za-z0-9_-]{43}$/, { error: 'invalid' });
const businessId = () => z.uuid({ error: 'invalid' });

/** #32: the confirmation link's page posts what the link carries. */
export const confirmEmailSchema = z.strictObject({ businessId: businessId(), token: linkToken() });
export type ConfirmEmailInput = z.infer<typeof confirmEmailSchema>;

/** #30: "send me a reset link". */
export const resetRequestSchema = z.strictObject({ email: email() });
export type ResetRequestInput = z.infer<typeof resetRequestSchema>;

/** #30, #42: the reset link's page, with the new password. */
export const resetCompleteSchema = z.strictObject({
  businessId: businessId(),
  token: linkToken(),
  newPassword: newPassword(),
});
export type ResetCompleteInput = z.infer<typeof resetCompleteSchema>;

/** #31: the recovery key, typed with dashes or spaces or neither. */
export const recoveryResetSchema = z.strictObject({
  email: email(),
  recoveryKey: z
    .string({ error: 'required' })
    .min(1, { error: 'required' })
    .max(64, { error: 'too_long' }),
  newPassword: newPassword(),
});
export type RecoveryResetInput = z.infer<typeof recoveryResetSchema>;

/** #17: a sensitive change carries the owner's password in its body (design, section 6). */
export const ownerPasswordSchema = z.strictObject({ ownerPassword: typedPassword() });
export type OwnerPasswordInput = z.infer<typeof ownerPasswordSchema>;

/** #46: changing your own password needs the current one. */
export const changePasswordSchema = z.strictObject({
  currentPassword: typedPassword(),
  newPassword: newPassword(),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** #44: what the owner calls a counter computer. */
export const deviceNameSchema = z.strictObject({ name: text(40) });
export type DeviceNameInput = z.infer<typeof deviceNameSchema>;

/** A new recovery key, shown once (#31). */
export interface RecoveryKeyResult {
  recoveryKey: string;
}

/** A remembered computer in Settings (#44). */
export interface DeviceView {
  id: string;
  name: string | null;
  branchName: string;
  createdAt: string;
  lastSeenAt: string;
  /** The computer this request came from. */
  thisComputer: boolean;
}

/** #21, #38: unlocking needs the password again. */
export const unlockSchema = z.strictObject({ password: typedPassword() });
export type UnlockInput = z.infer<typeof unlockSchema>;

/**
 * Typing a bill makes no request, so the web app tells the server "still here" on the first
 * key press after a quiet spell and then at most this often (P1.4 design, section 5).
 */
export const ACTIVE_PING_MS = 30_000;

/**
 * The server locks the owner (or ends a staff login) only after the idle time plus this much,
 * so the last key presses between two pings can't make it act before the screen does.
 * Must cover `ACTIVE_PING_MS`; the margin is for the network and the two clocks.
 */
export const IDLE_GRACE_MS = 60_000;

/** A logged-in session, as `GET /api/session` and the login routes answer it. */
export interface ActiveSession {
  state: 'active' | 'locked';
  user: { id: string; role: 'owner' | 'staff'; name: string };
  business: { id: string; name: string };
  branch: { id: string; name: string };
  /** Sent back as `X-CSRF-Token` on every unsafe request (ADR 0009). */
  csrfToken: string;
  /** Minutes of inactivity before the owner's session locks or a staff session ends. */
  idleMinutes: number;
  /** #32: the owner's email is confirmed (staff have none: always true). */
  emailConfirmed: boolean;
  /** #45: this server sends email only to a few verified addresses (the demo). */
  emailLimited: boolean;
  /**
   * `02` #12: the most this person may discount without the owner's OK, in basis points; null
   * for the owner (no limit). For staff, the limit the owner set while the discount switch is
   * on; otherwise 0.
   */
  discountLimitBasisPoints: number | null;
  /** Everything this person holds right now, read on every request (P1.5, ADR 0044). */
  permissions: Permission[];
}

/** What `GET /api/session` answers. */
export type SessionView =
  | {
      state: 'none';
      /** The business this computer remembers, for the staff login tab (#28). */
      device: { businessName: string } | null;
    }
  | ActiveSession;
