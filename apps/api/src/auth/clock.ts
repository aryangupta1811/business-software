/** The time, injectable so tests can move it (owner auto-lock, staff idle end). */
export interface Clock {
  now(): Date;
}

/** Injection token for the `Clock` (the stock business date, P1.8). */
export const CLOCK = 'CLOCK';

export const SYSTEM_CLOCK: Clock = { now: () => new Date() };
