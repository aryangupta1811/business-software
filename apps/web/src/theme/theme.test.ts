import { expect, test, vi } from 'vitest';
// The real script from public/, run below the way the browser runs it.
import themeInit from '../../public/theme-init.js?raw';
import { readSavedTheme, setTheme, THEME_STORAGE_KEY } from './theme';

const isDark = () => document.documentElement.classList.contains('dark');

test('reads the saved theme, defaulting to light', () => {
  expect(readSavedTheme({ getItem: () => 'dark' })).toBe('dark');
  expect(readSavedTheme({ getItem: () => null })).toBe('light');
  expect(readSavedTheme({ getItem: () => 'purple' })).toBe('light');
});

test('blocked storage means light', () => {
  const storage = {
    getItem: () => {
      throw new DOMException('blocked', 'SecurityError');
    },
  };
  expect(readSavedTheme(storage)).toBe('light');
});

test('setTheme switches the class on <html> and saves the choice', () => {
  setTheme('dark');
  expect(isDark()).toBe(true);
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  setTheme('light');
  expect(isDark()).toBe(false);
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
});

test('setTheme still switches when storage is blocked', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('blocked', 'SecurityError');
  });
  setTheme('dark');
  expect(isDark()).toBe(true);
});

function runThemeInit() {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- runs the real public script as the browser does
  const script = new Function(themeInit) as () => void;
  script();
}

test('theme-init.js applies a saved dark theme before the app loads', () => {
  localStorage.setItem(THEME_STORAGE_KEY, 'dark');
  runThemeInit();
  expect(isDark()).toBe(true);
});

test('theme-init.js leaves light alone', () => {
  runThemeInit();
  expect(isDark()).toBe(false);
});

test('theme-init.js survives blocked storage', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('blocked', 'SecurityError');
  });
  expect(runThemeInit).not.toThrow();
  expect(isDark()).toBe(false);
});
