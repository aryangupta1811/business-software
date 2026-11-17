// Password hashing with Node's built-in Argon2id (ADR 0035). No native package: Node 24 ships it.
import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const argon2Async = promisify(argon2);

// OWASP's minimum for Argon2id: 19 MiB of memory, 2 passes, 1 lane (about 30 ms here).
const MEMORY_KIB = 19_456;
const PASSES = 2;
const PARALLELISM = 1;
const SALT_BYTES = 16;
const TAG_BYTES = 32;

// Limits for reading a stored string, so a corrupted row can't ask for gigabytes or minutes.
const MAX_MEMORY_KIB = 262_144;
const MAX_PASSES = 10;
const MAX_PARALLELISM = 8;

const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

// PHC strings use standard base64 without the trailing padding characters.
const encode = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '');

/**
 * Hashes a password into a PHC string, `$argon2id$v=19$m=…,t=…,p=…$<salt>$<hash>`, so each
 * stored hash carries the parameters it was made with. The password is used exactly as typed.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const tag = await argon2Async('argon2id', {
    message: Buffer.from(password, 'utf8'),
    nonce: salt,
    memory: MEMORY_KIB,
    passes: PASSES,
    parallelism: PARALLELISM,
    tagLength: TAG_BYTES,
  });
  const params = `m=${String(MEMORY_KIB)},t=${String(PASSES)},p=${String(PARALLELISM)}`;
  return `$argon2id$v=19$${params}$${encode(salt)}$${encode(tag)}`;
}

/** True only for the right password. A stored string it can't read is a refusal, never an error. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const match = PHC.exec(stored);
  if (!match) return false;
  const [, m = '', t = '', p = '', saltText = '', tagText = ''] = match;
  const memory = Number(m);
  const passes = Number(t);
  const parallelism = Number(p);
  const salt = Buffer.from(saltText, 'base64');
  const expected = Buffer.from(tagText, 'base64');
  if (
    passes < 1 ||
    passes > MAX_PASSES ||
    parallelism < 1 ||
    parallelism > MAX_PARALLELISM ||
    memory < 8 * parallelism ||
    memory > MAX_MEMORY_KIB ||
    salt.length < 8 ||
    expected.length < 16 ||
    expected.length > 64
  ) {
    return false;
  }
  const actual = await argon2Async('argon2id', {
    message: Buffer.from(password, 'utf8'),
    nonce: salt,
    memory,
    passes,
    parallelism,
    tagLength: expected.length,
  });
  return timingSafeEqual(actual, expected);
}
