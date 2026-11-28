import { PRINT_SIZES } from '@business-software/shared';
import { describe, expect, it } from 'vitest';
import { FONT_FILES, printCss } from './css.js';

const urlOf = (file: string) => `/fonts/${file}`;

/** The widths in mm a stylesheet gives its page: the first `width:NNmm` after the size class. */
function pageWidth(css: string, className: string): number {
  const match = new RegExp(`\\.${className}\\{width:(\\d+)mm`).exec(css);
  return Number(match?.[1]);
}

describe('printCss', () => {
  it.each(PRINT_SIZES)(
    'has no import and loads nothing but the fonts it was told about (%s)',
    (size) => {
      const css = printCss(size, urlOf);
      expect(css).not.toContain('@import');
      const urls = [...css.matchAll(/url\(([^)]*)\)/g)].map((match) => match[1]);
      expect(urls.length).toBe(FONT_FILES.length);
      for (const url of urls)
        expect(url).toMatch(/^"\/fonts\/ibm-plex-sans[a-z-]*-\d{3}-normal\.woff2"$/);
      expect(css).not.toMatch(/https?:/);
    },
  );

  it('asks for Latin and Devanagari Plex at three weights each', () => {
    expect(FONT_FILES).toHaveLength(6);
    const css = printCss('a4', urlOf);
    expect(css).toContain('font-family:"IBM Plex Sans Devanagari"');
    // The page waits for the fonts rather than printing in a fallback face.
    expect(css).toContain('font-display:block');
    expect(css).toContain('"IBM Plex Sans","IBM Plex Sans Devanagari",sans-serif');
  });

  it('prints receipts with no page margin, 72 mm and 48 mm wide', () => {
    const wide = printCss('80', urlOf);
    const narrow = printCss('58', urlOf);
    expect(wide).toContain('@page{margin:0}');
    expect(narrow).toContain('@page{margin:0}');
    expect(pageWidth(wide, 's80')).toBe(72);
    expect(pageWidth(narrow, 's58')).toBe(48);
  });

  it('prints A4 on A4 paper with a margin', () => {
    expect(printCss('a4', urlOf)).toContain('@page{size:A4;margin:12mm}');
  });

  it('carries only the rules of its own size', () => {
    expect(printCss('80', urlOf)).not.toContain('.s58{width');
    expect(printCss('58', urlOf)).not.toContain('.s80{width');
    expect(printCss('80', urlOf)).not.toContain('.a4');
    expect(printCss('a4', urlOf)).not.toContain('.s80');
  });

  it('lets a long item name wrap on narrow paper', () => {
    expect(printCss('58', urlOf)).toContain('.name,.shop p,.buyer p{overflow-wrap:anywhere}');
  });

  it('prints black on white, whatever the app theme', () => {
    const css = printCss('80', urlOf);
    expect(css).toContain('background:#fff;color:#000');
  });
});
