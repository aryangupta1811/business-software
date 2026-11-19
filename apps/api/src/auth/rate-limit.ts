// In-memory fixed-window counters (P1.4 design, section 7). The API runs as one process on one
// server (ADR 0011), so nothing is written to the database for a failed attempt; a restart
// clears the counters. A second API instance would need them in PostgreSQL.
import type { Clock } from './clock.js';

export interface Verdict {
  allowed: boolean;
  /** When the current window ends: the earliest time a refused key may try again. */
  retryAt: Date;
}

interface Window {
  startedAt: number;
  count: number;
}

// Above this many keys, expired windows are swept on the next new key, so memory stays bounded.
const SWEEP_ABOVE = 10_000;

export class RateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly clock: Clock,
  ) {}

  /** Whether `key` is still under its limit, without counting. */
  check(key: string): Verdict {
    const window = this.current(key);
    return this.verdict(window, (window?.count ?? 0) < this.limit);
  }

  /** Counts one for `key` if it is under its limit; a refused hit doesn't count. */
  hit(key: string): Verdict {
    let window = this.current(key);
    if (window === undefined) {
      const now = this.clock.now().getTime();
      if (this.windows.size >= SWEEP_ABOVE) this.sweep(now);
      window = { startedAt: now, count: 0 };
      this.windows.set(key, window);
    }
    if (window.count >= this.limit) return this.verdict(window, false);
    window.count += 1;
    return this.verdict(window, true);
  }

  reset(key: string): void {
    this.windows.delete(key);
  }

  private current(key: string): Window | undefined {
    const window = this.windows.get(key);
    if (window !== undefined && this.clock.now().getTime() - window.startedAt >= this.windowMs) {
      this.windows.delete(key);
      return undefined;
    }
    return window;
  }

  private verdict(window: Window | undefined, allowed: boolean): Verdict {
    const startedAt = window?.startedAt ?? this.clock.now().getTime();
    return { allowed, retryAt: new Date(startedAt + this.windowMs) };
  }

  private sweep(now: number): void {
    for (const [key, window] of this.windows) {
      if (now - window.startedAt >= this.windowMs) this.windows.delete(key);
    }
  }
}
