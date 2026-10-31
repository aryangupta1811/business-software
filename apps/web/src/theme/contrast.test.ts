import { describe, expect, test } from 'vitest';
// ?raw: the file's text, through Vite, so the web app needs no Node types.
import styles from '../styles.css?raw';
import { contrastRatio, readTokens } from './contrast';

test('black on white is 21:1 and a colour on itself is 1:1', () => {
  expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 2);
  expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 2);
});

test('understands short hex, as the production CSS minifier writes it', () => {
  expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 2);
  expect(contrastRatio('#06c', '#ffffff')).toBeCloseTo(contrastRatio('#0066cc', '#ffffff'), 6);
});

test('the order of the two colours does not matter', () => {
  expect(contrastRatio('#ffffff', '#0071e3')).toBeCloseTo(contrastRatio('#0071e3', '#ffffff'), 6);
});

test('reads the light and dark token blocks, hex values only', () => {
  const css = `
    :root {
      --background: #f5f5f7;
      --card-shadow: 0 1px 2px rgb(0 0 0 / 0.04);
    }
    .dark {
      --background: #000000;
    }`;
  expect(readTokens(css)).toEqual({
    light: { background: '#f5f5f7' },
    dark: { background: '#000000' },
  });
});

const tokens = readTokens(styles);

test('finds the colour tokens in styles.css', () => {
  expect(tokens.light.background, styles.slice(0, 200)).toBe('#f5f5f7');
});

test('light and dark define the same colour tokens', () => {
  expect(Object.keys(tokens.dark).sort()).toEqual(Object.keys(tokens.light).sort());
});

// Readability is the owner's number one priority (spec section 3): WCAG AA for text,
// 7:1 for the main text, 3:1 for input edges and the focus ring.
const RULES: [foreground: string, backgrounds: string[], minimum: number][] = [
  ['foreground', ['background', 'surface'], 7],
  ['muted', ['background', 'surface', 'sidebar'], 4.5],
  ['accent', ['background', 'surface'], 4.5],
  ['on-primary', ['primary', 'danger-strong'], 4.5],
  ['success', ['surface', 'success-soft'], 4.5],
  ['warning', ['surface', 'warning-soft'], 4.5],
  ['danger', ['surface', 'danger-soft'], 4.5],
  ['input-border', ['surface'], 3],
  ['accent', ['sidebar'], 3],
];

describe.each(['light', 'dark'] as const)('%s mode', (mode) => {
  const colours = tokens[mode];
  test.each(RULES.flatMap(([fg, bgs, min]) => bgs.map((bg) => [fg, bg, min] as const)))(
    '%s on %s is at least %s:1',
    (fg, bg, min) => {
      const a = colours[fg] ?? '';
      const b = colours[bg] ?? '';
      expect(a, `--${fg} is missing`).not.toBe('');
      expect(b, `--${bg} is missing`).not.toBe('');
      const ratio = contrastRatio(a, b);
      expect(ratio, `${fg} ${a} on ${bg} ${b} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
        min,
      );
    },
  );
});
