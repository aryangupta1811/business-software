import { expect, test } from 'vitest';
import styles from '../styles.css?raw';

const SIZES = ['label', 'body', 'section', 'title', 'figure'];

// Each text-* class sets its own line height, so a line height on <body> alone doesn't
// reach buttons, labels or titles. Hindi must raise every size's own variable.
test('Hindi gives every text size a line height of at least 1.6', () => {
  const block = /^\s*html\[lang='hi'\]\s*\{([^}]*)\}/m.exec(styles)?.[1] ?? '';
  for (const size of SIZES) {
    const value = new RegExp(`--text-${size}--line-height:\\s*([\\d.]+)`).exec(block)?.[1];
    expect(Number(value), `--text-${size}--line-height in Hindi`).toBeGreaterThanOrEqual(1.6);
  }
});
