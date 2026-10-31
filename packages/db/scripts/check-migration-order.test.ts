import { describe, expect, it } from 'vitest';
import { findOutOfOrderMigrations } from './check-migration-order.js';

const first = { tag: '0000_first', when: 1000 };
const second = { tag: '0001_second', when: 2000 };

describe('findOutOfOrderMigrations', () => {
  it('returns nothing when the PR adds no migration', () => {
    expect(findOutOfOrderMigrations([first, second], [first, second])).toEqual([]);
  });

  it('accepts a new migration newer than every one on main', () => {
    const added = { tag: '0002_new', when: 3000 };
    expect(findOutOfOrderMigrations([first, second], [first, second, added])).toEqual([]);
  });

  it('rejects a new migration older than the newest on main', () => {
    // Generated on a branch before main gained 0001_second: Drizzle would skip it.
    const added = { tag: '0001_old', when: 1500 };
    expect(findOutOfOrderMigrations([first, second], [first, second, added])).toEqual(['0001_old']);
  });

  it('rejects a new migration with the same timestamp as the newest on main', () => {
    const added = { tag: '0002_same', when: 2000 };
    expect(findOutOfOrderMigrations([first, second], [first, second, added])).toEqual([
      '0002_same',
    ]);
  });

  it('accepts any migration when main has none', () => {
    expect(findOutOfOrderMigrations([], [first])).toEqual([]);
  });

  it('reports only the old one of two new migrations', () => {
    const old = { tag: '0002_old', when: 1500 };
    const fresh = { tag: '0003_new', when: 3000 };
    expect(findOutOfOrderMigrations([first, second], [first, second, old, fresh])).toEqual([
      '0002_old',
    ]);
  });
});
