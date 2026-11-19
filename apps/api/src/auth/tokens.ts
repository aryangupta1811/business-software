// Session, device and CSRF tokens (P1.4 design, section 4). A token is 32 random bytes; only its
// SHA-256 is stored, so a leaked backup can't be replayed as a live session.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 in lower-case hex, the form the database stores and checks. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** True when `token` hashes to `hash`, compared in constant time. */
export function tokenMatches(token: string, hash: string): boolean {
  const actual = Buffer.from(hashToken(token), 'hex');
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * The CSRF token belonging to a session: derived from the session token, so it needn't be
 * stored in plain text, yet can be handed out again after a page reload. Knowing it doesn't
 * reveal the session token.
 */
export function csrfTokenFor(sessionToken: string): string {
  return createHash('sha256').update(`csrf:${sessionToken}`, 'utf8').digest('base64url');
}

export interface CookieToken {
  businessId: string;
  token: string;
}

/** `<businessId>.<token>`: the business travels next to the token, so lookups run under RLS. */
export function formatCookieToken({ businessId, token }: CookieToken): string {
  return `${businessId}.${token}`;
}

/** The parts of a cookie value, or null for anything malformed (never an error). */
export function readCookieToken(value: string | undefined): CookieToken | null {
  if (value === undefined) return null;
  const dot = value.indexOf('.');
  const businessId = value.slice(0, dot);
  const token = value.slice(dot + 1);
  return dot > 0 && UUID.test(businessId) && TOKEN.test(token) ? { businessId, token } : null;
}
