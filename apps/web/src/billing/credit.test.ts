import { describe, expect, it } from 'vitest';
import { creditApprovalCovers, type CreditApproval } from './credit';

const NOW = Date.parse('2026-11-28T10:00:00.000Z');
const approval: CreditApproval = {
  approvalId: '00000000-0000-4000-8000-0000000000a1',
  billKey: 'bill-1',
  amountPaise: 50_000,
  expiresAt: '2026-11-28T10:30:00.000Z',
};

describe('creditApprovalCovers', () => {
  it('covers the udhaar up to the amount the owner allowed, on this bill, until it runs out', () => {
    expect(creditApprovalCovers(approval, 'bill-1', 50_000, NOW)).toBe(true);
    expect(creditApprovalCovers(approval, 'bill-1', 1, NOW)).toBe(true);
  });

  it('does not cover more than the owner allowed', () => {
    expect(creditApprovalCovers(approval, 'bill-1', 50_001, NOW)).toBe(false);
  });

  it('does not cover another bill, an expired OK, or no OK at all', () => {
    expect(creditApprovalCovers(approval, 'bill-2', 100, NOW)).toBe(false);
    expect(creditApprovalCovers(approval, 'bill-1', 100, Date.parse(approval.expiresAt))).toBe(
      false,
    );
    expect(creditApprovalCovers(null, 'bill-1', 100, NOW)).toBe(false);
  });
});
