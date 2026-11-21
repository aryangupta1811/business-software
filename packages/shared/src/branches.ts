// Branches (P1.6; Module 00 #12–#14, #35, #54–#60): the shops of one business. Error messages
// are codes the web app translates (ADR 0036).
import { z } from 'zod';
import { ownerPasswordSchema } from './auth.js';
import { isValidGstin, optionalText, text, uuid } from './fields.js';
import { optionalCode, optionalPattern, stateCode } from './schemas.js';
import { isBranchStateCode } from './states.js';

/** 1 to 6 capital letters or digits: short enough for an invoice number (`ABC/AND/2026-27/001`). */
export const BRANCH_CODE_PATTERN = /^[A-Z0-9]{1,6}$/;

const branchCode = () =>
  z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().toUpperCase() : value),
    z
      .string({ error: 'required' })
      .min(1, { error: 'required' })
      .regex(BRANCH_CODE_PATTERN, { error: 'invalid' }),
  );

/**
 * `POST /api/branches` and `PUT /api/branches/:id`: the branch's own details. The business-wide
 * GST rules (an unregistered business holds no GSTIN; the GSTIN carries the business's PAN) are
 * checked by the service, which knows the business.
 */
export const branchSchema = z
  .strictObject({
    name: text(100),
    code: branchCode(),
    address: optionalText(300, { multiline: true }),
    pinCode: optionalPattern(6, /^[1-9]\d{5}$/),
    stateCode: stateCode(),
    gstin: optionalCode(15, isValidGstin),
    drugLicence: optionalText(60),
    fssai: optionalPattern(14, /^\d{14}$/),
  })
  .superRefine((value, context) => {
    if (value.gstin === null || !isValidGstin(value.gstin) || !isBranchStateCode(value.stateCode)) {
      return;
    }
    if (value.gstin.slice(0, 2) !== value.stateCode) {
      context.addIssue({ code: 'custom', path: ['gstin'], message: 'state_mismatch' });
    }
  });
export type BranchInput = z.infer<typeof branchSchema>;

/** `GET /api/branches?includeArchived=true`. */
export const branchesQuerySchema = z.strictObject({
  includeArchived: z
    .enum(['true', 'false'], { error: 'invalid' })
    .optional()
    .transform((value) => value === 'true'),
});
export type BranchesQuery = z.infer<typeof branchesQuerySchema>;

/** `PUT /api/devices/:id/branch`: move a remembered computer (owner's password). */
export const deviceBranchSchema = ownerPasswordSchema.extend({ branchId: uuid() });
export type DeviceBranchInput = z.infer<typeof deviceBranchSchema>;

/** `PUT /api/staff/:id/branches`: the extra branches a login may work at (owner's password). */
export const staffBranchesSchema = ownerPasswordSchema.extend({
  branchIds: z
    .array(uuid(), { error: 'invalid' })
    .max(100, { error: 'invalid' })
    .refine((ids) => new Set(ids).size === ids.length, { error: 'duplicate' }),
});
export type StaffBranchesInput = z.infer<typeof staffBranchesSchema>;

/** A branch in a list or a picker. */
export interface BranchRef {
  id: string;
  code: string;
  name: string;
}

/** One branch on the Settings card. */
export interface BranchView extends BranchRef {
  address: string | null;
  pinCode: string | null;
  stateCode: string;
  gstin: string | null;
  drugLicence: string | null;
  fssai: string | null;
  /** The oldest branch: the business's details and GSTIN rule belong to it; never archived. */
  headOffice: boolean;
  archived: boolean;
  /** Remembered computers here (forgotten ones don't count). */
  computers: number;
  /** Active staff logins whose home this is. */
  staff: number;
}

/** What a login answers when the owner's first login on a new computer must pick its branch. */
export interface ChooseBranch {
  code: 'choose_branch';
  branches: BranchRef[];
}
