/** An amount of money in whole paise (₹12.50 = 1250). Always a safe integer (ADR 0008). */
export type Paise = number;

const RUPEE_INPUT = /^(\d*)(?:\.(\d{0,2}))?$/;

/**
 * Reads an amount typed in rupees ("125.50") as paise (12550).
 * Returns null for anything that isn't plainly an amount, so the screen asks again instead of guessing.
 */
export function parseRupees(input: string): Paise | null {
  const match = RUPEE_INPUT.exec(input.trim());
  if (!match) return null;
  const [, rupees = '', paise = ''] = match;
  if (rupees === '' && paise === '') return null;
  // Only whole numbers are multiplied, so no floating-point rounding can creep in.
  const amount = Number(rupees) * 100 + Number(paise.padEnd(2, '0'));
  return Number.isSafeInteger(amount) ? amount : null;
}

const RUPEES = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

/** Shows paise as rupees with Indian digit grouping: 12345678 → "₹1,23,456.78". */
export function formatPaise(paise: Paise): string {
  if (!Number.isSafeInteger(paise)) {
    throw new RangeError(`Not a whole number of paise: ${String(paise)}`);
  }
  const digits = String(Math.abs(paise)).padStart(3, '0');
  const sign = paise < 0 ? '-' : '';
  // A decimal string, not paise / 100, so the amount never becomes a float.
  // TypeScript can't tell that a built-up string holds a number, hence the `as`.
  const decimal = `${sign}${digits.slice(0, -2)}.${digits.slice(-2)}` as `${number}`;
  return RUPEES.format(decimal);
}
