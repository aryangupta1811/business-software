import { describe, expect, test, vi } from 'vitest';
import { changeLanguage, i18n, readSavedLanguage } from '.';

const storageWith = (value: string | null) => ({ getItem: () => value });

describe('readSavedLanguage', () => {
  test.each(['en', 'hi', 'hi-Latn'])('returns the saved %s', (code) => {
    expect(readSavedLanguage(storageWith(code))).toBe(code);
  });

  test.each([null, 'fr', 'HI', 'hi-latn', ''])('falls back to English for %j', (value) => {
    expect(readSavedLanguage(storageWith(value))).toBe('en');
  });

  test('falls back to English when storage is blocked', () => {
    const blocked = {
      getItem: () => {
        throw new DOMException('Access denied', 'SecurityError');
      },
    };
    expect(readSavedLanguage(blocked)).toBe('en');
  });
});

describe('changeLanguage', () => {
  test('switches the text, the page language and the saved choice', async () => {
    await changeLanguage('hi');
    expect(i18n.t('home.title')).toBe('स्वागत है');
    expect(document.documentElement.lang).toBe('hi');
    expect(localStorage.getItem('language')).toBe('hi');
  });

  test('still switches when the choice cannot be saved', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    await changeLanguage('hi-Latn');
    expect(i18n.t('home.title')).toBe('Swagat hai');
    expect(document.documentElement.lang).toBe('hi-Latn');
  });
});

test('a string missing from Hinglish shows English, not Devanagari Hindi', async () => {
  i18n.addResource('en', 'translation', 'test.onlyEnglishAndHindi', 'In English');
  i18n.addResource('hi', 'translation', 'test.onlyEnglishAndHindi', 'हिन्दी में');
  await changeLanguage('hi-Latn');
  const t = i18n.t as unknown as (key: string) => string;
  expect(t('test.onlyEnglishAndHindi')).toBe('In English');
});
