import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashRecoveryKey, makeRecoveryKey, readRecoveryKey } from './recovery-key.js';

const FORMAT = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){7}$/;

describe('recovery keys', () => {
  it('shows 160 random bits as eight groups of four letters and digits', () => {
    const { key } = makeRecoveryKey();
    expect(key).toMatch(FORMAT);
    expect(makeRecoveryKey().key).not.toBe(key);
  });

  it('stores the SHA-256 of the key bytes, never the key', () => {
    const { key, hash } = makeRecoveryKey();
    const bytes = readRecoveryKey(key);
    expect(bytes).toHaveLength(20);
    expect(hash).toBe(
      createHash('sha256')
        .update(bytes ?? Buffer.alloc(0))
        .digest('hex'),
    );
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(key.replaceAll('-', '').toLowerCase());
  });

  // P1.4 reads what the owner types back: case, spaces and look-alike letters are forgiven.
  it('reads a key back however it was typed', () => {
    const { key, hash } = makeRecoveryKey();
    const typed = ` ${key.toLowerCase().replaceAll('-', ' ').replaceAll('0', 'o').replaceAll('1', 'l')} `;
    expect(hashRecoveryKey(typed)).toBe(hash);
  });

  it.each(['', 'ABCD', `${'A'.repeat(31)}U`, 'A'.repeat(33), 'ÄBCD'.repeat(8)])(
    'refuses %j',
    (typed) => {
      expect(readRecoveryKey(typed)).toBeNull();
      expect(hashRecoveryKey(typed)).toBeNull();
    },
  );
});
