import { argon2 } from 'node:crypto';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { hashPassword, needsRehash, verifyPassword } from './password.js';

const PHC = /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/;

describe('passwords', () => {
  // RFC 9106 section 5.3, so we know Node's argon2 is called the way the standard means.
  it('matches the published Argon2id test vector', async () => {
    const tag = await promisify(argon2)('argon2id', {
      message: Buffer.alloc(32, 1),
      nonce: Buffer.alloc(16, 2),
      secret: Buffer.alloc(8, 3),
      associatedData: Buffer.alloc(12, 4),
      memory: 32,
      passes: 3,
      parallelism: 4,
      tagLength: 32,
    });
    expect(tag.toString('hex')).toBe(
      '0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659',
    );
  });

  it('stores a PHC string with its parameters and a fresh salt each time', async () => {
    const first = await hashPassword('correct horse');
    const second = await hashPassword('correct horse');
    expect(first).toMatch(PHC);
    expect(second).toMatch(PHC);
    expect(first).not.toBe(second);
  });

  it('accepts the right password and refuses a wrong one', async () => {
    const stored = await hashPassword('correct horse');
    expect(await verifyPassword('correct horse', stored)).toBe(true);
    expect(await verifyPassword('correct horsE', stored)).toBe(false);
    expect(await verifyPassword('', stored)).toBe(false);
  });

  it('keeps spaces and non-English letters as they are', async () => {
    const stored = await hashPassword(' दुकान की चाबी ');
    expect(await verifyPassword(' दुकान की चाबी ', stored)).toBe(true);
    expect(await verifyPassword('दुकान की चाबी', stored)).toBe(false);
  });

  // P1.4 may raise the parameters later; hashes stored before then must still verify.
  it('verifies a hash made with other parameters, read from the string', async () => {
    const salt = Buffer.alloc(16, 7);
    const tag = await promisify(argon2)('argon2id', {
      message: Buffer.from('correct horse'),
      nonce: salt,
      memory: 8192,
      passes: 3,
      parallelism: 1,
      tagLength: 32,
    });
    const b64 = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '');
    const stored = `$argon2id$v=19$m=8192,t=3,p=1$${b64(salt)}$${b64(tag)}`;
    expect(await verifyPassword('correct horse', stored)).toBe(true);
    expect(await verifyPassword('correct horse', stored.replace('t=3', 't=2'))).toBe(false);
  });

  it.each([
    '',
    'plain text',
    '$argon2i$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0$aGFzaA',
    '$argon2id$v=16$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaA',
    '$argon2id$v=19$m=99999999,t=2,p=1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaA',
    '$argon2id$v=19$m=19456,t=99,p=1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaA',
    '$argon2id$v=19$m=19456,t=2,p=1$c2Fs$aGFzaGhhc2hoYXNoaGFzaA',
    '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0$aA',
  ])('refuses a malformed stored hash %j without throwing', async (stored) => {
    expect(await verifyPassword('correct horse', stored)).toBe(false);
  });

  // ADR 0035: raise the cost later and rehash each user at their next login.
  it('asks for a rehash only when the stored parameters differ from today', async () => {
    expect(needsRehash(await hashPassword('correct horse'))).toBe(false);
    expect(needsRehash('$argon2id$v=19$m=8192,t=3,p=1$c2FsdHNhbHRzYWx0$aGFzaA')).toBe(true);
    expect(needsRehash('not a hash')).toBe(true);
  });
});
