// A small seeded random number generator (ADR 0016: "a fixed random seed"). The same seed gives
// the same shop every run, so screenshots, end-to-end tests and the AI eval can rely on it.

/** mulberry32: 32 bits of state, plenty for picking items and times. Not for secrets. */
export function createRandom(seed: number) {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    /** A number in [0, 1). */
    next,
    /** A whole number from `min` to `max`, both included. */
    int: (min: number, max: number): number => min + Math.floor(next() * (max - min + 1)),
    /** True with probability `p`. */
    chance: (p: number): boolean => next() < p,
    /** One element, evenly. */
    pick: <T>(list: readonly T[]): T => {
      const item = list[Math.floor(next() * list.length)];
      if (item === undefined) throw new RangeError('Nothing to pick from');
      return item;
    },
    /** One element, each with its own weight. */
    weighted: <T>(list: readonly T[], weight: (item: T) => number): T => {
      const total = list.reduce((sum, item) => sum + weight(item), 0);
      let at = next() * total;
      for (const item of list) {
        at -= weight(item);
        if (at < 0) return item;
      }
      const last = list[list.length - 1];
      if (last === undefined) throw new RangeError('Nothing to pick from');
      return last;
    },
    /** A random UUID (version 4 layout), so bill keys repeat from run to run. */
    uuid: (): string => {
      const hex = Array.from({ length: 32 }, () => Math.floor(next() * 16).toString(16)).join('');
      const variant = (8 + Math.floor(next() * 4)).toString(16);
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    },
  };
}

export type Random = ReturnType<typeof createRandom>;
