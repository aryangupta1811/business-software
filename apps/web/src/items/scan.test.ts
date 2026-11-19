import { expect, test } from 'vitest';
import { isTextEntry, SCAN_GAP_MS, ScanBuffer } from './scan';

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

test('knows when a burst is under way, so its keys aren’t taken as shortcuts', () => {
  const buffer = new ScanBuffer();
  expect(buffer.inBurst(1000)).toBe(false);
  buffer.key('A', 1000);
  expect(buffer.inBurst(1005)).toBe(true);
  expect(buffer.inBurst(1000 + SCAN_GAP_MS + 1)).toBe(false);
});

// A scan right after using a checkbox or a select must still count.
test('only text fields take a scanner’s typing', () => {
  const element = (html: string) => {
    const host = document.createElement('div');
    host.innerHTML = html;
    return host.firstElementChild;
  };
  expect(isTextEntry(element('<input type="search">'))).toBe(true);
  expect(isTextEntry(element('<input>'))).toBe(true);
  expect(isTextEntry(element('<textarea></textarea>'))).toBe(true);
  expect(isTextEntry(element('<div contenteditable="true"></div>'))).toBe(true);
  expect(isTextEntry(element('<input type="checkbox">'))).toBe(false);
  expect(isTextEntry(element('<select></select>'))).toBe(false);
  expect(isTextEntry(element('<button></button>'))).toBe(false);
  expect(isTextEntry(document.body)).toBe(false);
});
