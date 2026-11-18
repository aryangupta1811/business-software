// Building blocks for request and form schemas (ADR 0036). Every check's message is an error
// *code* (`too_long`), never English: the web app translates codes into the chosen language.
import { z } from 'zod';

export type FieldErrors = Record<string, string>;

// Unicode's control characters (Cc: C0, DEL and C1, which include NUL, refused by PostgreSQL
// in text and jsonb) and its invisible format characters (Cf: right-to-left overrides that
// make a name on a bill read differently from what's stored, zero-width spaces, BOMs). Except
// the zero-width joiner and non-joiner (U+200D, U+200C), which Devanagari spelling needs.
const CONTROL = /(?![‌‍])[\p{Cc}\p{Cf}]/u;
// The same, but allowing tab, line feed and carriage return in multi-line fields.
const CONTROL_EXCEPT_LINES = /(?![\t\n\r‌‍])[\p{Cc}\p{Cf}]/u;

interface TextOptions {
  /** Allow new lines (an address). */
  multiline?: boolean;
}

/** A required string: trimmed, 1 to `max` characters, no control characters. */
export function text(max: number, options: TextOptions = {}) {
  const control = options.multiline ? CONTROL_EXCEPT_LINES : CONTROL;
  return z
    .string({ error: 'required' })
    .trim()
    .min(1, { error: 'required' })
    .max(max, { error: 'too_long' })
    .refine((value) => !control.test(value), { error: 'control_character' });
}

/** An optional string: blank or null becomes null, anything else follows `text`. */
export function optionalText(max: number, options: TextOptions = {}) {
  return z.preprocess(
    (value) =>
      value === null || (typeof value === 'string' && value.trim() === '') ? null : value,
    text(max, options).nullable(),
  );
}

/**
 * A phone number as 10 digits: accepts `+91`, `91` or `0` in front, and spaces, dashes and
 * brackets anywhere. Landlines with their STD code are 10 digits too. Null when it isn't one.
 */
export function normalizePhone(input: string): string | null {
  let digits = input.replace(/[\s\-()]/g, '');
  if (digits.startsWith('+91')) digits = digits.slice(3);
  else if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[1-9]\d{9}$/.test(digits) ? digits : null;
}

export const phone = () =>
  z.string({ error: 'required' }).transform((value, context) => {
    const normalized = normalizePhone(value);
    if (normalized === null) {
      context.addIssue({ code: 'custom', message: value.trim() === '' ? 'required' : 'invalid' });
      return z.NEVER;
    }
    return normalized;
  });

export const email = () =>
  z
    .string({ error: 'required' })
    .trim()
    .toLowerCase()
    .min(1, { error: 'required' })
    .max(254, { error: 'too_long' })
    .regex(/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/, { error: 'invalid' })
    // Printable ASCII only, so one address has one spelling: a zero-width space copied from a
    // chat, a fullwidth or Cyrillic look-alike letter would otherwise make a second owner
    // account for the same mailbox (Module 00 #27). The database checks the same.
    .regex(/^[!-~]+$/, { error: 'invalid' });

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GSTIN_FORMAT = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/**
 * A GSTIN: 2-digit state code, the PAN, an entity number, `Z`, and a check digit computed
 * from the first 14 characters (weights 1 and 2 alternately, base 36).
 */
export function isValidGstin(gstin: string): boolean {
  if (!GSTIN_FORMAT.test(gstin)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const product = GSTIN_CHARS.indexOf(gstin.charAt(i)) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS.charAt((36 - (sum % 36)) % 36) === gstin.charAt(14);
}

/** One code per field (the first problem found); a body that isn't an object is `_`. */
export function fieldErrors(error: z.ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) errors[[...issue.path, key].join('.')] ??= 'unknown_field';
      continue;
    }
    const field = issue.path.length === 0 ? '_' : issue.path.join('.');
    errors[field] ??= issue.path.length === 0 ? 'invalid' : issue.message;
  }
  return errors;
}
