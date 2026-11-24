// Customers at the billing counter (P1.13 design §7; `02` #2, #7; `03` #1). A walk-in bill needs
// none; a business customer brings a GSTIN, legal name and address. P1.18 adds credit limit,
// due days and the udhaar ledger. Error messages are codes the web app translates (ADR 0036).
import { z } from 'zod';
import { MAX_BILL_PAISE } from './billing.js';
import { isValidGstin, optionalPhone, optionalText, text } from './fields.js';
import { isStateCode } from './states.js';
import { MAX_DUE_DAYS } from './udhaar.js';

const PIN_CODE = /^[1-9]\d{5}$/;

const customerShape = {
  name: text(100),
  phone: optionalPhone(),
  gstin: optionalText(15)
    .transform((value) => (value === null ? null : value.toUpperCase()))
    .refine((value) => value === null || isValidGstin(value), { error: 'invalid' }),
  legalName: optionalText(100),
  address: optionalText(200, { multiline: true }),
  pinCode: optionalText(6).refine((value) => value === null || PIN_CODE.test(value), {
    error: 'invalid',
  }),
  /** From the GSTIN when there is one; else picked (a B2C bill "sent to" another state). */
  stateCode: z
    .string({ error: 'invalid' })
    .refine((code) => isStateCode(code), { error: 'invalid' })
    .nullable(),
  /**
   * `03` #8, #17: the most udhaar the customer may owe; null is "no limit set". Left out, a new
   * customer has none and a saved one keeps theirs.
   */
  creditLimitPaise: z
    .int({ error: 'invalid' })
    .min(0, { error: 'too_small' })
    .max(MAX_BILL_PAISE, { error: 'too_big' })
    .nullable()
    .optional(),
  /** `03` #5: days from a bill to its due date. Left out, 30 for a new customer, else unchanged. */
  dueDays: z
    .int({ error: 'invalid' })
    .min(0, { error: 'too_small' })
    .max(MAX_DUE_DAYS, { error: 'too_big' })
    .optional(),
};

type CustomerFields = z.infer<z.ZodObject<typeof customerShape>>;

/**
 * Design §7: a GSTIN needs the legal name and address printed on a tax invoice, and its first two
 * digits are the customer's state.
 */
function customerRules<T extends CustomerFields>(value: T, context: z.core.$RefinementCtx<T>): T {
  if (value.gstin === null) return value;
  if (value.legalName === null) {
    context.addIssue({ code: 'custom', path: ['legalName'], message: 'required' });
  }
  if (value.address === null) {
    context.addIssue({ code: 'custom', path: ['address'], message: 'required' });
  }
  const fromGstin = value.gstin.slice(0, 2);
  if (value.stateCode !== null && value.stateCode !== fromGstin) {
    context.addIssue({ code: 'custom', path: ['stateCode'], message: 'gstin_state' });
  }
  return { ...value, stateCode: fromGstin };
}

/** `POST /api/customers`. */
export const customerSchema = z.strictObject(customerShape).transform(customerRules);
export type CustomerInput = z.infer<typeof customerSchema>;

/** `PUT /api/customers/:id`: the whole customer with the version it was read at. */
export const customerUpdateSchema = z
  .strictObject({
    ...customerShape,
    version: z.int({ error: 'invalid' }).min(1, { error: 'invalid' }),
  })
  .transform(customerRules);
export type CustomerUpdateInput = z.infer<typeof customerUpdateSchema>;

/** `GET /api/customers`: by phone (`F3` at the counter) or by name, phone or GSTIN text. */
export const customerQuerySchema = z
  .strictObject({
    phone: optionalPhone().optional(),
    q: optionalText(100).optional(),
  })
  .transform((query, context) => {
    const found = Object.fromEntries(
      Object.entries(query).filter(([, value]) => value !== null && value !== undefined),
    ) as { phone?: string; q?: string };
    if (found.phone === undefined && found.q === undefined) {
      context.addIssue({ code: 'custom', path: ['q'], message: 'required' });
    }
    return found;
  });
export type CustomerQuery = z.infer<typeof customerQuerySchema>;

export interface CustomerView {
  id: string;
  name: string;
  phone: string | null;
  gstin: string | null;
  legalName: string | null;
  address: string | null;
  pinCode: string | null;
  stateCode: string | null;
  /** Null: no limit set (`03` #17). */
  creditLimitPaise: number | null;
  dueDays: number;
  version: number;
}
