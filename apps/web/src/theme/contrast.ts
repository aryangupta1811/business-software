/** WCAG 2 relative luminance of a `#rrggbb` or `#rgb` colour (the minifier writes `#fff`). */
function luminance(colour: string): number {
  const hex = colour.length === 4 ? colour.replace(/[0-9a-f]/gi, '$&$&') : colour;
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

/** Tokens in the blocks that aren't colours, so they may hold other values. */
const NOT_COLOURS = new Set(['card-shadow']);

/**
 * The colour tokens of the `:root` (light) and `.dark` blocks of `styles.css`. Every other
 * token must be a 6-digit hex colour: one written another way would slip past the contrast
 * test, so it throws instead.
 */
export function readTokens(css: string): {
  light: Record<string, string>;
  dark: Record<string, string>;
} {
  const block = (selector: string) => {
    const body = new RegExp(`^\\s*${selector}\\s*\\{([^}]*)\\}`, 'm').exec(css)?.[1] ?? '';
    const tokens: Record<string, string> = {};
    for (const [, name = '', raw = ''] of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
      if (NOT_COLOURS.has(name)) continue;
      const value = raw.trim();
      if (!/^#[0-9a-f]{6}$/i.test(value)) {
        throw new Error(`--${name} is not a 6-digit hex colour: ${value}`);
      }
      tokens[name] = value.toLowerCase();
    }
    return tokens;
  };
  return { light: block(':root'), dark: block('\\.dark') };
}
