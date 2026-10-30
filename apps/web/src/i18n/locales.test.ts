import { describe, expect, test } from 'vitest';
import en from './locales/en.json';
import hiLatn from './locales/hi-Latn.json';
import hi from './locales/hi.json';

const DEVANAGARI = /\p{Script=Devanagari}/u;

/** Every leaf as [dotted key, value], so files can be compared key by key. */
function leaves(tree: object, prefix = ''): [string, unknown][] {
  return Object.entries(tree as Record<string, unknown>).flatMap(
    ([key, value]): [string, unknown][] =>
      typeof value === 'object' && value !== null
        ? leaves(value, `${prefix}${key}.`)
        : [[`${prefix}${key}`, value]],
  );
}

const keysOf = (tree: object) => leaves(tree).map(([key]) => key);

describe.each([
  ['hi', hi],
  ['hi-Latn', hiLatn],
])('%s', (_code, locale) => {
  test('has exactly the keys of English', () => {
    expect(keysOf(locale).sort()).toEqual(keysOf(en).sort());
  });

  test('has no empty or non-string values', () => {
    for (const [key, value] of leaves(locale)) {
      expect(typeof value === 'string' && value.trim() !== '', key).toBe(true);
    }
  });
});

test('English has no empty values', () => {
  for (const [key, value] of leaves(en)) {
    expect(typeof value === 'string' && value.trim() !== '', key).toBe(true);
  }
});

test('Hindi is written in Devanagari', () => {
  for (const [key, value] of leaves(hi)) {
    expect(DEVANAGARI.test(String(value)), key).toBe(true);
  }
});

test('Hinglish is written in English letters only', () => {
  for (const [key, value] of leaves(hiLatn)) {
    expect(DEVANAGARI.test(String(value)), key).toBe(false);
  }
});
