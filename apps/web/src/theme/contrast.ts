/** WCAG 2 relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((start) => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, from 1 (same colour) to 21 (black on white). Order doesn't matter. */
export function contrastRatio(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

/** The hex colour tokens of the `:root` (light) and `.dark` blocks of `styles.css`. */
export function readTokens(css: string): {
  light: Record<string, string>;
  dark: Record<string, string>;
} {
  const block = (selector: string) => {
    const body = new RegExp(`^\\s*${selector}\\s*\\{([^}]*)\\}`, 'm').exec(css)?.[1] ?? '';
    return Object.fromEntries(
      [...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map(([, name = '', value = '']) => [
        name,
        value.toLowerCase(),
      ]),
    );
  };
  return { light: block(':root'), dark: block('\\.dark') };
}
