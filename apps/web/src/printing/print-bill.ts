// Printing a bill from the browser (P1.15 design section 3): the template is drawn into a hidden
// frame with the stylesheet for the paper size, and the frame is printed. With Chrome's
// `--kiosk-printing` it goes to the default printer with no dialog.
import type { BillDetailView, PrintSize } from '@business-software/shared';
import { fontUrl } from './fonts';
import { printFrame } from './print-frame';

/** The fonts are fetched when the page first uses them; give up waiting after this long. */
const FONTS_WAIT_MS = 3_000;
/** A frame that never reports `afterprint` (some browsers) is removed after this long. */
const FRAME_LIFETIME_MS = 60_000;

/**
 * The CSP's `style-src 'self'` refuses an inline <style> in the frame, so the stylesheet goes
 * in through the CSSOM (`adoptedStyleSheets`). A browser without it (jsdom, in the tests) gets
 * a <style> element instead; it has no CSP.
 */
export function addStylesheet(frame: HTMLIFrameElement, css: string): void {
  const doc = frame.contentDocument;
  const win = frame.contentWindow as (Window & typeof globalThis) | null;
  if (doc === null || win === null) throw new Error('The print frame has no document');
  if ('adoptedStyleSheets' in doc && 'replaceSync' in win.CSSStyleSheet.prototype) {
    // Made by the frame's own CSSStyleSheet: a sheet can only be adopted by its own document.
    const sheet = new win.CSSStyleSheet();
    sheet.replaceSync(css);
    doc.adoptedStyleSheets = [sheet];
  } else {
    const style = doc.createElement('style');
    style.textContent = css;
    doc.head.append(style);
  }
}

/** Waits until the frame's fonts are ready, or for a few seconds, whichever comes first. */
async function fontsReady(doc: Document): Promise<void> {
  // jsdom has no document.fonts.
  const fonts = (doc as { fonts?: FontFaceSet }).fonts;
  if (fonts === undefined) return;
  // Reading the layout makes the page ask for the fonts it uses, so `ready` waits for them.
  doc.body.getBoundingClientRect();
  await Promise.race([
    fonts.ready,
    new Promise<void>((resolve) => setTimeout(resolve, FONTS_WAIT_MS)),
  ]);
}

/**
 * Prints `bill` at `size`. `reprintedAt` (an ISO moment) puts the "Reprint" line under the
 * title (`02` #33). Resolves when the browser has been handed the page.
 */
export async function printBill(
  bill: BillDetailView,
  size: PrintSize,
  reprintedAt: string | null,
): Promise<void> {
  const { printCss, renderBill } = await import('@business-software/print');
  const frame = document.createElement('iframe');
  frame.title = bill.number;
  frame.tabIndex = -1;
  frame.setAttribute('aria-hidden', 'true');
  // Not display:none, which some browsers refuse to print; one invisible pixel instead.
  frame.className = 'pointer-events-none fixed top-0 left-0 size-px border-0 opacity-0';
  document.body.append(frame);
  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    frame.remove();
  };
  setTimeout(remove, FRAME_LIFETIME_MS);
  try {
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (doc === null || win === null) throw new Error('The print frame has no document');
    doc.documentElement.lang = bill.language;
    doc.body.innerHTML = renderBill(bill, { size, reprintedAt });
    addStylesheet(frame, printCss(size, fontUrl));
    await fontsReady(doc);
    win.addEventListener('afterprint', remove);
    printFrame(win);
  } catch (error) {
    remove();
    throw error;
  }
}
