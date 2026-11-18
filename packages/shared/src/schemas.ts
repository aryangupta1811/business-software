// Request bodies for signup and settings (ADR 0036): the server parses them, and the forms
// use the same schemas, so the screen and the API can't disagree.
import { z } from 'zod';
import { BUSINESS_TYPES, FEATURES, GST_STATUSES } from './business.js';
import { email, isValidGstin, normalizePhone, optionalText, phone, text } from './fields.js';
import { isBranchStateCode } from './states.js';

// A pick-one field left empty says `choose`, not `invalid`: missing from the body, an empty
// select (''), or a radio group with nothing picked (the form library sends null).
const choose = (issue: { input?: unknown }) =>
  issue.input === undefined || issue.input === null || issue.input === '' ? 'choose' : 'invalid';

/** Where the business's branch stands. */
const stateCode = () =>
  z
    .string({ error: choose })
    .refine((value) => value !== '', { error: 'choose' })
    .refine(isBranchStateCode, { error: 'invalid' });

/** An optional upper-case code (PAN, GSTIN): blank is null, otherwise it must pass `valid`. */
function optionalCode(max: number, valid: (value: string) => boolean) {
  return z.preprocess(
    (value) => (typeof value === 'string' ? value.toUpperCase() : value),
    optionalText(max).refine((value) => value === null || valid(value), { error: 'invalid' }),
  );
}

const optionalPattern = (max: number, pattern: RegExp) =>
  optionalText(max).refine((value) => value === null || pattern.test(value), {
    error: 'invalid',
  });

const PAN = /^[A-Z]{5}\d{4}[A-Z]$/;
const businessName = () => text(100);
const businessType = () => z.enum(BUSINESS_TYPES, { error: choose });
const gstStatus = () => z.enum(GST_STATUSES, { error: choose });

/** Module 00 #7: seven fields. */
export const signupSchema = z
  .strictObject({
    businessName: businessName(),
    businessType: businessType(),
    phone: phone(),
    stateCode: stateCode(),
    gstStatus: gstStatus(),
    email: email(),
    // Never trimmed: spaces are part of a password. At least 10 characters, no forced symbols.
    password: z
      .string({ error: 'required' })
      .min(1, { error: 'required' })
      .min(10, { error: 'too_short' })
      .max(128, { error: 'too_long' }),
  })
  .superRefine((value, context) => {
    if (value.password.trim().toLowerCase() === value.email) {
      context.addIssue({ code: 'custom', path: ['password'], message: 'same_as_email' });
    }
    if (normalizePhone(value.password) === value.phone) {
      context.addIssue({ code: 'custom', path: ['password'], message: 'same_as_phone' });
    }
  });
export type SignupInput = z.infer<typeof signupSchema>;

/** What the signup answers: the recovery key leaves the server only here (Module 00 #31). */
export interface SignupResult {
  businessId: string;
  recoveryKey: string;
}

/** The business and its first branch (Module 00 #8, #14). */
export const settingsBusinessSchema = z
  .strictObject({
    businessName: businessName(),
    businessType: businessType(),
    phone: phone(),
    gstStatus: gstStatus(),
    pan: optionalCode(10, (value) => PAN.test(value)),
    ownerName: optionalText(100),
    branchName: text(100),
    address: optionalText(300, { multiline: true }),
    pinCode: optionalPattern(6, /^[1-9]\d{5}$/),
    stateCode: stateCode(),
    gstin: optionalCode(15, isValidGstin),
    drugLicence: optionalText(60),
    fssai: optionalPattern(14, /^\d{14}$/),
  })
  // Zod runs this even when a field's own check failed, so only checked values are compared.
  .superRefine((value, context) => {
    if (value.gstin === null || !isValidGstin(value.gstin) || !isBranchStateCode(value.stateCode)) {
      return;
    }
    if (value.gstin.slice(0, 2) !== value.stateCode) {
      context.addIssue({ code: 'custom', path: ['gstin'], message: 'state_mismatch' });
    } else if (
      value.pan !== null &&
      PAN.test(value.pan) &&
      value.gstin.slice(2, 12) !== value.pan
    ) {
      context.addIssue({ code: 'custom', path: ['gstin'], message: 'pan_mismatch' });
    }
  });
export type SettingsBusinessInput = z.infer<typeof settingsBusinessSchema>;

export const settingsFeaturesSchema = z.strictObject({
  features: z
    .array(z.enum(FEATURES, { error: 'invalid' }), { error: 'invalid' })
    .refine((features) => new Set(features).size === features.length, { error: 'duplicate' })
    // One fixed order, so a reordered list isn't a change (and no entry-log row).
    .transform((features) => FEATURES.filter((feature) => features.includes(feature))),
});
export type SettingsFeaturesInput = z.infer<typeof settingsFeaturesSchema>;

const minutes = (min: number, max: number) =>
  z.int({ error: 'invalid' }).min(min, { error: 'too_small' }).max(max, { error: 'too_big' });

/** Module 00 #21 (owner auto-lock, 1–30) and #29 (staff idle logout, 5–120). */
export const settingsSecuritySchema = z.strictObject({
  ownerLockMinutes: minutes(1, 30),
  staffIdleMinutes: minutes(5, 120),
});
export type SettingsSecurityInput = z.infer<typeof settingsSecuritySchema>;

/** What `GET /api/settings` answers, and every save returns. */
export interface SettingsView {
  business: SettingsBusinessInput;
  features: SettingsFeaturesInput['features'];
  security: SettingsSecurityInput;
}
