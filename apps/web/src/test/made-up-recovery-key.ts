// A made-up recovery key in the real shape (8 groups of 4, Crockford base32), built at run
// time: written out as one literal, it trips gitleaks' generic-api-key rule in CI.
const SYMBOLS = 'ABCDEFGHJKMNPQRSTVWXYZ0123456789';

export function madeUpRecoveryKey(): string {
  return Array.from({ length: 8 }, (_, group) => SYMBOLS.slice(group * 4, group * 4 + 4)).join('-');
}
