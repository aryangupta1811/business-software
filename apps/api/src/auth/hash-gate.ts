// Caps how many Argon2id hashes run at once (ADR 0035: about 19 MiB each on a 2 GB server).
// Extra calls wait in line; beyond the line's length the caller gets BusyError (503).

export class BusyError extends Error {
  constructor() {
    super('Too many password checks waiting');
  }
}

export class HashGate {
  private running = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(
    private readonly maxRunning = 2,
    private readonly maxWaiting = 20,
  ) {}

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.running >= this.maxRunning) {
      if (this.waiting.length >= this.maxWaiting) throw new BusyError();
      // The slot is handed over by the call that finishes (below), so it stays counted.
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.running += 1;
    }
    try {
      return await work();
    } finally {
      const next = this.waiting.shift();
      if (next === undefined) this.running -= 1;
      else next();
    }
  }
}
