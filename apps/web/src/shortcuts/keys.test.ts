import { expect, test } from 'vitest';
import { keyLabels, parseKeys } from './keys';

test('parses function keys, Escape and ?', () => {
  expect(parseKeys('F2')).toEqual({ ctrl: false, alt: false, shift: false, key: 'F2' });
  expect(parseKeys('Escape')).toEqual({ ctrl: false, alt: false, shift: false, key: 'Escape' });
  expect(parseKeys('?')).toEqual({ ctrl: false, alt: false, shift: false, key: '?' });
});

test('letters and digits become physical key codes', () => {
  expect(parseKeys('Alt+H')).toEqual({ ctrl: false, alt: true, shift: false, key: 'KeyH' });
  expect(parseKeys('Ctrl+Shift+K')).toEqual({ ctrl: true, alt: false, shift: true, key: 'KeyK' });
  expect(parseKeys('Alt+1')).toEqual({ ctrl: false, alt: true, shift: false, key: 'Digit1' });
});

test('a letter alone is refused: it would fire while typing', () => {
  expect(() => parseKeys('H')).toThrow(/needs Ctrl or Alt/);
});

test("the browser's own keys are refused", () => {
  for (const keys of ['F5', 'F11', 'F12', 'Ctrl+T', 'Ctrl+W', 'Ctrl+N', 'Ctrl+R', 'Ctrl+L']) {
    expect(() => parseKeys(keys), keys).toThrow(/browser/);
  }
});

test('unknown keys are refused', () => {
  expect(() => parseKeys('Alt+Ä')).toThrow(/Unknown key/);
  expect(() => parseKeys('Hyper+H')).toThrow(/Unknown key/);
});

test('labels for the key chips', () => {
  expect(keyLabels('Alt+H')).toEqual(['Alt', 'H']);
  expect(keyLabels('?')).toEqual(['?']);
});
