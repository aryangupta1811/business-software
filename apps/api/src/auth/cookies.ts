// The two cookies (P1.4 design, section 4). `__Host-` names need `Secure`, so plain-HTTP local
// development (COOKIE_SECURE=false) uses unprefixed names.

/** Chrome's longest cookie lifetime (Module 00 #44). */
export const DEVICE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

export interface CookieNames {
  session: string;
  device: string;
}

export function cookieNames(secure: boolean): CookieNames {
  return secure
    ? { session: '__Host-session', device: '__Host-device' }
    : { session: 'session', device: 'device' };
}

/** The request's cookies by name. The first of a repeated name wins; bad encodings are skipped. */
export function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const raw of (header ?? '').split(';')) {
    const part = raw.trim();
    const equals = part.indexOf('=');
    if (equals < 1) continue;
    const name = part.slice(0, equals).trim();
    if (cookies.has(name)) continue;
    try {
      cookies.set(name, decodeURIComponent(part.slice(equals + 1).trim()));
    } catch {
      // A malformed %-escape: not one of ours.
    }
  }
  return cookies;
}

interface CookieOptions {
  secure: boolean;
  /** Seconds. None: the cookie ends with the browser (Module 00 #40). 0 removes it. */
  maxAge?: number;
}

/** A `Set-Cookie` value: HttpOnly, SameSite=Lax, the whole site (ADR 0009). */
export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (options.secure) parts.push('Secure');
  if (options.maxAge !== undefined) parts.push(`Max-Age=${String(options.maxAge)}`);
  return parts.join('; ');
}
