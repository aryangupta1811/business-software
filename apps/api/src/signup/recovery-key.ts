// Recovery keys (Module 00 #31): shown once at signup, then only their hash is kept.
import { createHash, randomBytes } from 'node:crypto';

// Crockford's base32: no I, L, O or U, so a written-down key reads back without confusion.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const KEY_BYTES = 20; // 160 bits, 32 characters
const GROUP = 4;

function encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  return out;
}

/** The key's bytes from what the owner typed, or null if it isn't a key. */
export function readRecoveryKey(typed: string): Buffer | null {
  const cleaned = typed
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (cleaned.length !== (KEY_BYTES * 8) / 5) return null;
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of cleaned) {
    const digit = ALPHABET.indexOf(char);
    if (digit === -1) return null;
    value = ((value << 5) | digit) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/**
 * SHA-256 is enough here: a slow hash protects guessable passwords, and 160 random bits can't
 * be guessed. Stored as 64 hex characters.
 */
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** The hash to compare with the stored one, or null if the typed text isn't a key (P1.4). */
export function hashRecoveryKey(typed: string): string | null {
  const bytes = readRecoveryKey(typed);
  return bytes === null ? null : sha256(bytes);
}

/** A new key to show once, and the hash to store. */
export function makeRecoveryKey(): { key: string; hash: string } {
  const bytes = randomBytes(KEY_BYTES);
  const groups = encode(bytes).match(new RegExp(`.{${String(GROUP)}}`, 'g')) ?? [];
  return { key: groups.join('-'), hash: sha256(bytes) };
}
