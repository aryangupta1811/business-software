import { expect, test } from 'vitest';
import { SCAN_GAP_MS, ScanBuffer } from './scan';

/** Feeds keys `gap` ms apart and returns what the last one gave. */
function feed(buffer: ScanBuffer, keys: string[], gap: number, start = 1000): string | null {
  let result: string | null = null;
  keys.forEach((key, index) => {
    result = buffer.key(key, start + index * gap);
  });
  return result;
}

const keysOf = (code: string) => [...Array.from(code), 'Enter'];

test('a fast burst ended by Enter is a scan', () => {
  expect(feed(new ScanBuffer(), keysOf('8901234567890'), 5)).toBe('8901234567890');
});

test('typing at a person’s speed is not a scan', () => {
  expect(feed(new ScanBuffer(), keysOf('8901234567890'), SCAN_GAP_MS + 30)).toBeNull();
});

test('fewer than four characters is not a scan', () => {
  expect(feed(new ScanBuffer(), keysOf('890'), 5)).toBeNull();
});

test('a pause starts a new burst, so slow keys before a scan are dropped', () => {
  const buffer = new ScanBuffer();
  feed(buffer, ['x', 'y'], 200);
  expect(feed(buffer, keysOf('ABCD-12'), 5, 5000)).toBe('ABCD-12');
});

test('Shift (for capitals) keeps the burst going', () => {
  expect(
    feed(new ScanBuffer(), ['Shift', 'A', 'Shift', 'B', ...Array.from('1234'), 'Enter'], 5),
  ).toBe('AB1234');
});

test('a key that prints nothing (an arrow) or a non-ASCII letter breaks the burst', () => {
  expect(
    feed(new ScanBuffer(), [...Array.from('1234'), 'ArrowLeft', ...Array.from('56'), 'Enter'], 5),
  ).toBeNull();
  expect(
    feed(new ScanBuffer(), [...Array.from('12'), 'क', ...Array.from('34'), 'Enter'], 5),
  ).toBeNull();
});
