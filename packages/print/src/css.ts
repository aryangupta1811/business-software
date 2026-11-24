// The stylesheet for a printed bill, one per paper size. It is a string, not a file, so the page
// can hand it to `adoptedStyleSheets` (an inline <style> is refused by the page's CSP) and the
// worker can put it in a <style> of a page it controls (PR 2). Bills print black on white,
// whatever theme the app is in.
import type { PrintSize } from '@business-software/shared';

/** The font files a bill needs (IBM Plex, ADR 0025), by the names @fontsource gives them. */
export const FONT_FILES = [400, 500, 600].flatMap((weight) => [
  {
    family: 'IBM Plex Sans',
    weight,
    file: `ibm-plex-sans-latin-${String(weight)}-normal.woff2`,
  },
  {
    family: 'IBM Plex Sans Devanagari',
    weight,
    file: `ibm-plex-sans-devanagari-devanagari-${String(weight)}-normal.woff2`,
  },
]);

function fontFaces(urlOf: (file: string) => string): string {
  return FONT_FILES.map(
    ({ family, weight, file }) =>
      `@font-face{font-family:"${family}";font-weight:${String(weight)};font-style:normal;` +
      `font-display:block;src:url("${urlOf(file)}") format("woff2")}`,
  ).join('\n');
}

const BASE = `
html,body{margin:0;background:#fff;color:#000}
.bill{font-family:"IBM Plex Sans","IBM Plex Sans Devanagari",sans-serif;color:#000;line-height:1.35;font-variant-numeric:tabular-nums}
.bill *{box-sizing:border-box}
.bill h1,.bill h2,.bill h3,.bill p,.bill dl,.bill dd{margin:0}
.bill small{font-size:.85em}
.name,.shop p,.buyer p{overflow-wrap:anywhere}
.shop-name{font-weight:600}
.title{font-weight:600}
.declaration{font-size:.85em}
.reprint{font-weight:500}
.meta div,.row,.calc,.fine{display:flex;justify-content:space-between;gap:2mm}
.meta dt{font-weight:500}
.buyer h3,.payments h3,.summary h3{font-weight:600}
.row.grand,.grand{font-weight:600}
.note{overflow-wrap:anywhere}
`;

const RECEIPT = `
.s80,.s58{margin:0 auto}
.s80 .shop,.s58 .shop{text-align:center;padding-bottom:2mm;border-bottom:1px dashed #000}
.s80 .shop-name,.s58 .shop-name{font-size:1.3em}
.s80 .title,.s58 .title{text-align:center;margin:2mm 0 1mm;letter-spacing:.03em}
.s80 .declaration,.s58 .declaration{text-align:center;margin-top:2mm}
.s80 .reprint,.s58 .reprint{text-align:center;margin-bottom:1mm;border:1px solid #000;padding:0 2mm}
.s80 .supply,.s58 .supply{margin-top:1mm}
.s80 .buyer,.s58 .buyer{margin-top:2mm;padding-top:1mm;border-top:1px dashed #000}
.s80 .buyer h3,.s58 .buyer h3{font-size:.85em}
.s80 .lines,.s58 .lines{margin-top:2mm;border-top:1px dashed #000}
.s80 .line,.s58 .line{padding:1mm 0;border-bottom:1px dotted #666;break-inside:avoid}
.s80 .name,.s58 .name{font-weight:500}
.s80 .amt,.s58 .amt{white-space:nowrap}
.s80 .fine,.s58 .fine{flex-wrap:wrap;font-size:.85em}
.s80 .totals,.s58 .totals{padding-top:1mm}
.s80 .taxes,.s58 .taxes{margin-top:2mm;padding-bottom:1mm;border-bottom:1px dotted #666}
.s80 .trow,.s58 .trow{display:flex;flex-wrap:wrap;justify-content:space-between;gap:0 2mm;font-size:.85em}
.s80 .row.strong,.s58 .row.strong{font-weight:500}
.s80 .row.grand,.s58 .row.grand{margin-top:1mm;padding:1mm 0;border-top:1px solid #000;border-bottom:1px solid #000;font-size:1.25em}
.s80 .payments,.s58 .payments{margin-top:2mm}
.s80 .payments h3,.s58 .payments h3{font-size:.85em}
.s80 .note,.s58 .note{margin-top:3mm;text-align:center}
`;

const SIZES: Record<PrintSize, string> = {
  '80': `@page{margin:0}\n.s80{width:72mm;padding:3mm 0 8mm;font-size:9.5pt}\n${RECEIPT}`,
  '58': `@page{margin:0}\n.s58{width:48mm;padding:3mm 0 8mm;font-size:8.5pt}\n${RECEIPT}`,
  a4: `@page{size:A4;margin:12mm}
.a4{width:100%;font-size:10pt}
.a4 .top{display:grid;grid-template-columns:1fr 1fr;gap:8mm;padding-bottom:4mm;border-bottom:2px solid #000}
.a4 .shop-name{font-size:16pt}
.a4 .doc{text-align:right}
.a4 .title{font-size:18pt}
.a4 .reprint{display:inline-block;border:1px solid #000;padding:0 2mm;margin-top:1mm}
.a4 .meta{margin-top:2mm}
.a4 .meta div{justify-content:flex-end}
.a4 .buyer{margin-top:4mm;padding:2mm 3mm;border:1px solid #000;break-inside:avoid}
.a4 .items{width:100%;margin-top:4mm;border-collapse:collapse;font-size:9pt}
.a4 th,.a4 td{padding:1.5mm;text-align:right;vertical-align:top;border-bottom:1px solid #bbb}
.a4 th{border-top:2px solid #000;border-bottom:2px solid #000;font-weight:600}
.a4 .left{text-align:left}
.a4 thead{display:table-header-group}
.a4 tr{break-inside:avoid}
.a4 .bottom{display:grid;grid-template-columns:1.25fr 1fr;gap:8mm;margin-top:5mm;break-inside:avoid}
.a4 .summary table{width:100%;border-collapse:collapse;font-size:9pt}
.a4 .summary h3,.a4 .payments h3{margin-bottom:1mm}
.a4 .words{margin-top:3mm}
.a4 .payments{margin-top:3mm}
.a4 .totals .row{padding:.7mm 0}
.a4 .totals .row.grand{margin-top:1mm;padding:1.5mm 0;border-top:2px solid #000;border-bottom:2px solid #000;font-size:12pt}
.a4 .note{margin-top:4mm}
.a4 .signature{margin-top:12mm;text-align:right;break-inside:avoid}
.a4 .sign-line{display:inline-block;min-width:60mm;margin-top:14mm;padding-top:1mm;border-top:1px solid #000;text-align:center}
`,
};

/**
 * The CSS for a bill at this size. `urlOf` turns a font file name (from `FONT_FILES`) into the
 * URL the page loads it from: the browser passes its bundled files, the worker file paths.
 */
export function printCss(size: PrintSize, urlOf: (file: string) => string): string {
  return `${fontFaces(urlOf)}\n${BASE}${SIZES[size]}`;
}
