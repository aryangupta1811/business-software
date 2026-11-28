// The owner's OK for udhaar past a credit limit (P1.18 design §5, `03` #9, #18): its own
// approval, apart from a discount's, for one bill and up to the amount shown.
import type { Paise } from '@business-software/shared';

export interface CreditApproval {
  approvalId: string;
  billKey: string;
  /** The most udhaar the owner allowed on this bill. */
  amountPaise: Paise;
  expiresAt: string;
}

/** True when `approval` is for this bill, covers `udhaarPaise` and hasn't run out. */
export function creditApprovalCovers(
  approval: CreditApproval | null,
  billKey: string,
  udhaarPaise: Paise,
  now: number,
): boolean {
  return (
    approval !== null &&
    approval.billKey === billKey &&
    approval.amountPaise >= udhaarPaise &&
    Date.parse(approval.expiresAt) > now
  );
}
