import { sampleBill } from '@business-software/print';
import type { BillDetailView } from '@business-software/shared';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { addStylesheet, printBill } from './print-bill';
import { printFrame } from './print-frame';

vi.mock('./print-frame', () => ({ printFrame: vi.fn() }));

afterEach(() => {
  vi.mocked(printFrame).mockReset();
  for (const frame of document.querySelectorAll('iframe')) frame.remove();
});

/** What the frame held at the moment it was handed to the printer. */
async function printed(
  bill: BillDetailView,
  size: 'a4' | '80' | '58' = '80',
  again: string | null = null,
) {
  const pages: { html: string; css: string; lang: string; inlineStyles: number }[] = [];
  vi.mocked(printFrame).mockImplementation((win) => {
    pages.push({
      html: win.document.body.innerHTML,
      css: win.document.head.textContent,
      lang: win.document.documentElement.lang,
      inlineStyles: win.document.querySelectorAll('[style]').length,
    });
  });
  await printBill(bill, size, again);
  const [page] = pages;
  if (page === undefined) throw new Error('Nothing was printed');
  return page;
}

describe('printBill', () => {
  test('draws the bill and the stylesheet of its paper size in a frame, and prints it', async () => {
    const page = await printed(sampleBill(), '58');
    expect(printFrame).toHaveBeenCalledTimes(1);
    expect(page.html).toContain('class="bill s58 ');
    expect(page.html).toContain('Basmati rice');
    expect(page.css).toContain('.s58{width:48mm');
    expect(page.lang).toBe('en');
  });

  test('puts the bill language on the page', async () => {
    expect((await printed(sampleBill({ language: 'hi' }))).lang).toBe('hi');
  });

  test('loads the fonts from this app, by full address', async () => {
    const page = await printed(sampleBill());
    expect(page.css).toMatch(/url\("http:\/\/[^"]*ibm-plex-sans-latin-400-normal[^"]*"\)/);
    expect(page.css).toMatch(/url\("http:\/\/[^"]*ibm-plex-sans-devanagari-devanagari-600-normal/);
  });

  test('uses no inline style: the page’s CSP would refuse it', async () => {
    const page = await printed(sampleBill({ interState: true }), 'a4', '2026-11-24T09:00:00.000Z');
    expect(page.inlineStyles).toBe(0);
    expect(page.html).not.toMatch(/\sstyle\s*=/i);
  });

  test('writes the reprint line only when it is given the date', async () => {
    expect((await printed(sampleBill())).html).not.toContain('Reprint');
    expect((await printed(sampleBill(), '80', '2026-11-24T09:00:00.000Z')).html).toContain(
      'Reprint',
    );
  });

  test('escapes what the shop typed', async () => {
    const [first, ...others] = sampleBill().lines;
    if (first === undefined) throw new Error('no lines');
    const bill: BillDetailView = {
      ...sampleBill(),
      lines: [{ ...first, itemName: '<script>alert(1)</script>' }, ...others],
    };
    const page = await printed(bill);
    expect(page.html).not.toContain('<script');
    expect(page.html).toContain('&lt;script&gt;');
  });

  test('adopts the stylesheet when the browser can, with no <style> element (the CSP)', () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (doc === null || win === null) throw new Error('no frame document');
    const texts: string[] = [];
    class FakeSheet {
      replaceSync(text: string) {
        texts.push(text);
      }
    }
    Object.assign(doc, { adoptedStyleSheets: [] });
    Object.assign(win, { CSSStyleSheet: FakeSheet });
    addStylesheet(frame, '@page{margin:0}');
    expect((doc as unknown as { adoptedStyleSheets: unknown[] }).adoptedStyleSheets).toHaveLength(
      1,
    );
    expect(texts).toEqual(['@page{margin:0}']);
    expect(doc.querySelectorAll('style')).toHaveLength(0);
  });

  test('falls back to a <style> element when the browser cannot adopt', () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    addStylesheet(frame, '@page{margin:0}');
    expect(frame.contentDocument?.querySelector('style')?.textContent).toBe('@page{margin:0}');
  });

  test('removes its frame when the browser says the printing is over, and when printing throws', async () => {
    await printed(sampleBill());
    const frame = document.querySelector('iframe');
    expect(frame).not.toBeNull();
    frame?.contentWindow?.dispatchEvent(new Event('afterprint'));
    expect(document.querySelector('iframe')).toBeNull();

    vi.mocked(printFrame).mockImplementation(() => {
      throw new Error('no printer');
    });
    await expect(printBill(sampleBill(), '80', null)).rejects.toThrow('no printer');
    expect(document.querySelector('iframe')).toBeNull();
  });
});
