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
    throw new RangeError(`Not a safe whole number of paise: ${String(paise)}`);
  }
  const digits = String(Math.abs(paise)).padStart(3, '0');
  const sign = paise < 0 ? '-' : '';
  // A decimal string, not paise / 100, so the amount never becomes a float.
  // TypeScript can't tell that a built-up string holds a number, hence the `as`.
  const decimal = `${sign}${digits.slice(0, -2)}.${digits.slice(-2)}` as `${number}`;
  return RUPEES.format(decimal);
}

function assertPaise(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      `${what} must be a safe whole number of paise, 0 or more: ${String(value)}`,
    );
  }
}

/**
 * Shares `total` paise out in proportion to `weights`, so the shares always add up to the total.
 * Rule (largest remainder): each share is rounded down, then the paise left over go one each
 * to the shares with the biggest remainders; on a tie, the earlier share gets it first.
 * Works in BigInt, so total × weight can't lose precision past 2^53.
 */
export function allocatePaise(total: Paise, weights: readonly Paise[]): Paise[] {
  assertPaise(total, 'The total');
  for (const weight of weights) assertPaise(weight, 'A weight');

  const bigTotal = BigInt(total);
  const sumOfWeights = weights.reduce((sum, weight) => sum + BigInt(weight), 0n);
  if (sumOfWeights === 0n) {
    if (total === 0) return weights.map(() => 0);
    throw new RangeError(`Can't share ${String(total)} paise: every weight is 0`);
  }

  const shares = weights.map((weight) => (bigTotal * BigInt(weight)) / sumOfWeights);
  const remainders = weights.map((weight) => (bigTotal * BigInt(weight)) % sumOfWeights);
  let leftover = bigTotal - shares.reduce((sum, share) => sum + share, 0n);

  // Indexes by remainder, biggest first; Array.prototype.sort is stable, so ties keep line order.
  const order = remainders
    .map((remainder, index) => ({ remainder, index }))
    .sort((a, b) => (a.remainder === b.remainder ? 0 : a.remainder > b.remainder ? -1 : 1));
  for (const { index } of order) {
    if (leftover === 0n) break;
    shares[index] = (shares[index] ?? 0n) + 1n;
    leftover -= 1n;
  }
  return shares.map(Number);
}
