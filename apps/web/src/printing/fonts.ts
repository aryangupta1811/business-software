// The font files a printed bill needs, served from our own origin (the CSP allows fonts only
// from there). The names are the ones the print package asks for (`FONT_FILES`).
import devanagari400 from '@fontsource/ibm-plex-sans-devanagari/files/ibm-plex-sans-devanagari-devanagari-400-normal.woff2?url';
import devanagari500 from '@fontsource/ibm-plex-sans-devanagari/files/ibm-plex-sans-devanagari-devanagari-500-normal.woff2?url';
import devanagari600 from '@fontsource/ibm-plex-sans-devanagari/files/ibm-plex-sans-devanagari-devanagari-600-normal.woff2?url';
import latin400 from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2?url';
import latin500 from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-500-normal.woff2?url';
import latin600 from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2?url';

const URLS: Record<string, string> = {
  'ibm-plex-sans-latin-400-normal.woff2': latin400,
  'ibm-plex-sans-latin-500-normal.woff2': latin500,
  'ibm-plex-sans-latin-600-normal.woff2': latin600,
  'ibm-plex-sans-devanagari-devanagari-400-normal.woff2': devanagari400,
  'ibm-plex-sans-devanagari-devanagari-500-normal.woff2': devanagari500,
  'ibm-plex-sans-devanagari-devanagari-600-normal.woff2': devanagari600,
};

/**
 * The full URL of a font file. The bill is printed from a frame whose own address is
 * `about:blank`, so a path alone would not find the file.
 */
export function fontUrl(file: string): string {
  return new URL(URLS[file] ?? '', document.baseURI).href;
}
