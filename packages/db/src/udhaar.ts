// Stub so the tests can run and fail first.
import type { UdhaarEntryKind } from '@business-software/shared';
import type { Transaction } from './tenancy.js';

export type UdhaarRuleCode =
  | 'not_found'
  | 'invalid'
  | 'advance_changed'
  | 'opening_exists'
  | 'payment_not_found'
  | 'already_reversed';

export class UdhaarRuleError extends Error {
  constructor(
    readonly code: UdhaarRuleCode,
    readonly customerId: string,
    readonly availablePaise = 0,
  ) {
    super(`Udhaar rule ${code}`);
  }
}

export interface MoveUdhaarInput {
  customerId: string;
  branchId: string;
  actorId: string;
  businessDate: string;
  kind: UdhaarEntryKind;
  amountPaise: number;
  dueFrom?: string;
  billId?: string;
  mode?: 'cash' | 'upi' | 'card' | 'cheque';
  reference?: string | null;
  reversesEntryId?: string;
  reason?: string;
  requestKey?: string;
}

export interface MovedUdhaar {
  entryId: string;
  balanceBeforePaise: number;
  balanceAfterPaise: number;
  dueDate: string | null;
}

export function lockUdhaarAccount(_tx: Transaction, _customerId: string): Promise<number> {
  return Promise.reject(new Error('not implemented'));
}
export function moveUdhaar(_tx: Transaction, _input: MoveUdhaarInput): Promise<MovedUdhaar> {
  return Promise.reject(new Error('not implemented'));
}
export interface UdhaarMismatch {
  customerId: string;
  balancePaise: number;
  summedPaise: number;
  lastBalancePaise: number | null;
}
export function findUdhaarMismatches(_tx: Transaction): Promise<UdhaarMismatch[]> {
  return Promise.resolve([]);
}
