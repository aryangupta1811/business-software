// What the screens know about a customer's udhaar, as plain functions (P1.18 design §5, §7).
// The rules themselves live in `packages/shared` (`creditLimitVerdict`, `unpaidEntries`); the
// server decides again on every save, so this only keeps the screen in step with it.
import {
  creditLimitVerdict,
  type OverCreditLimitSetting,
  type Paise,
  type PaymentMode,
} from '@business-software/shared';

/** What the counter reads of a customer's account. */
export interface Standing {
  /** Above 0 they owe; below 0 it's an advance (`03` #6). */
  balancePaise: Paise;
  /** Null: no limit set (`03` #17). */
  creditLimitPaise: Paise | null;
}

/** Owes, has an advance, or neither. */
export function balanceKind(balancePaise: Paise): 'owes' | 'advance' | 'settled' {
  if (balancePaise > 0) return 'owes';
  return balancePaise < 0 ? 'advance' : 'settled';
}

/** The advance a customer can pay a bill from: 0 unless they have one. */
export function advanceOf(balancePaise: Paise): Paise {
  return Math.max(0, -balancePaise);
}

/** What a bill's payments put on the customer's account, and what they take from the advance. */
export function ledgerParts(payments: readonly { mode: PaymentMode; amountPaise: Paise }[]): {
  udhaarPaise: Paise;
  advancePaise: Paise;
} {
  const sum = (mode: PaymentMode) =>
    payments.reduce((total, row) => (row.mode === mode ? total + row.amountPaise : total), 0);
  return { udhaarPaise: sum('udhaar'), advancePaise: sum('advance') };
}

export type CreditCheck =
  | { kind: 'none' }
  | { kind: 'within' }
  /** Over the limit; the owner is only warned and the bill saves. */
  | { kind: 'warn'; balanceAfterPaise: Paise; limitPaise: Paise | null }
  /** Over the limit (or no limit set, for staff): the owner's password lets this bill through. */
  | { kind: 'needs_approval'; balanceAfterPaise: Paise; limitPaise: Paise | null };

/**
 * What the bill's udhaar does to the credit limit: the same rule the server applies when it
 * locks the account (`creditLimitVerdict`), on the balance the screen last read. The balance
 * after is the balance, less the advance used first, plus the udhaar given.
 */
export function creditCheck(input: {
  payments: readonly { mode: PaymentMode; amountPaise: Paise }[];
  standing: Standing;
  who: 'owner' | 'staff';
  setting: OverCreditLimitSetting;
}): CreditCheck {
  const { udhaarPaise, advancePaise } = ledgerParts(input.payments);
  if (udhaarPaise === 0) return { kind: 'none' };
  const balanceAfterPaise = input.standing.balancePaise - advancePaise + udhaarPaise;
  const limitPaise = input.standing.creditLimitPaise;
  const verdict = creditLimitVerdict({
    who: input.who,
    setting: input.setting,
    limitPaise,
    balanceAfterPaise,
  });
  return verdict === 'within'
    ? { kind: 'within' }
    : { kind: verdict, balanceAfterPaise, limitPaise };
}

/** How full the credit limit is, 0 to 100 (capped), or null when no limit is set. */
export function limitUsedPercent(balancePaise: Paise, limitPaise: Paise | null): number | null {
  if (limitPaise === null) return null;
  if (limitPaise === 0) return balancePaise > 0 ? 100 : 0;
  return Math.min(100, Math.max(0, Math.round((balancePaise / limitPaise) * 100)));
}

/**
 * Days a due date is past, as of `today` (both `YYYY-MM-DD`): 0 on the due day itself and
 * before it. Calendar days, so no time zone or daylight saving gets in.
 */
export function daysOverdue(dueDate: string, today: string): number {
  const days = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86_400_000;
  return Math.max(0, Math.round(days));
}
