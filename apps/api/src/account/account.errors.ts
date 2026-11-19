// What can go wrong in account recovery (P1.4 design, section 10). The controllers map each
// to an HTTP answer with a code the web app translates (toHttpError, ADR 0036).

/** A confirmation or reset link that is unknown, used, replaced or expired: one answer for all. */
export class InvalidLinkError extends Error {
  constructor() {
    super('Invalid link');
  }
}

/** A wrong recovery key or an unknown email: one answer for both (#31). */
export class WrongRecoveryKeyError extends Error {
  constructor() {
    super('Wrong recovery key');
  }
}

/** A new password that is the email or the phone number (Module 00 #7). */
export class WeakPasswordError extends Error {
  constructor(readonly code: 'same_as_email' | 'same_as_phone') {
    super('Weak password');
  }
}

/** "Send again" after the email is already confirmed. */
export class AlreadyConfirmedError extends Error {
  constructor() {
    super('Email already confirmed');
  }
}
