// Login request schemas and the session view (Module 00 #27, #28, #43; P1.4 design). Error
// messages are codes the web app translates (ADR 0036).
import { z } from 'zod';
import { email } from './fields.js';

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

/** #21, #38: unlocking needs the password again. */
export const unlockSchema = z.strictObject({ password: typedPassword() });
export type UnlockInput = z.infer<typeof unlockSchema>;

/** What `GET /api/session` answers. */
export type SessionView =
  | {
      state: 'none';
      /** The business this computer remembers, for the staff login tab (#28). */
      device: { businessName: string } | null;
    }
  | {
      state: 'active' | 'locked';
      user: { id: string; role: 'owner' | 'staff'; name: string };
      business: { id: string; name: string };
      branch: { id: string; name: string };
      /** Sent back as `X-CSRF-Token` on every unsafe request (ADR 0009). */
      csrfToken: string;
      /** Minutes of inactivity before the owner's session locks or a staff session ends. */
      idleMinutes: number;
    };
