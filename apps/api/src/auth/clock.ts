/** The time, injectable so tests can move it (owner auto-lock, staff idle end). */
export interface Clock {
  now(): Date;
}

export const SYSTEM_CLOCK: Clock = { now: () => new Date() };

/** Injection token for the one Clock (AppOptions.clock in tests; stock's business date, P1.8). */
export const CLOCK = 'CLOCK';
