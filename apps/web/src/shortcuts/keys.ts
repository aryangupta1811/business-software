/** A parsed shortcut. `key` is a physical code for letters and digits (`KeyH`, `Digit1`). */
export interface KeyCombo {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

const FUNCTION_KEY = /^F([1-9]|1[0-2])$/;
const MODIFIERS = { Ctrl: 'ctrl', Alt: 'alt', Shift: 'shift' } as const;

// New/close tab, new window and address bar; with Shift, reopen a closed tab, close the window,
// open a private window and reload without the cache; and closing a tab or the window by F4.
const BROWSER_KEYS = [
  'Ctrl+T',
  'Ctrl+W',
  'Ctrl+N',
  'Ctrl+R',
  'Ctrl+L',
  'Ctrl+Shift+T',
  'Ctrl+Shift+W',
  'Ctrl+Shift+N',
  'Ctrl+Shift+R',
  'Ctrl+F4',
  'Alt+F4',
];
// Reload, full screen and dev tools: reserved with any modifier (Ctrl+F5, Shift+F5, Ctrl+Shift+F12…).
const BROWSER_FUNCTION_KEYS = new Set(['F5', 'F11', 'F12']);

/** True for keys that type a character, so they fire with no modifier only outside fields. */
export function isFunctionOrEscape(key: string): boolean {
  return key === 'Escape' || FUNCTION_KEY.test(key);
}

function parse(keys: string): KeyCombo {
  const parts = keys.split('+');
  const name = parts.pop() ?? '';
  const combo: KeyCombo = { ctrl: false, alt: false, shift: false, key: name };
  for (const part of parts) {
    if (!(part in MODIFIERS)) throw new Error(`Unknown key "${part}" in "${keys}"`);
    combo[MODIFIERS[part as keyof typeof MODIFIERS]] = true;
  }
  if (/^[A-Z]$/i.test(name)) combo.key = `Key${name.toUpperCase()}`;
  else if (/^[0-9]$/.test(name)) combo.key = `Digit${name}`;
  else if (name === '/') combo.key = 'Slash';
  else if (name === 'Delete') {
    // Delete alone deletes text in a field, so only Ctrl+Delete or Alt+Delete can be a command.
    if (!combo.ctrl && !combo.alt) throw new Error(`Shortcut "${keys}" needs Ctrl or Alt`);
  } else if (!isFunctionOrEscape(name) && name !== '?') {
    throw new Error(`Unknown key "${name}" in "${keys}"`);
  }
  // A plain letter or digit would fire while someone types a name or a quantity.
  if (/^(Key|Digit)/.test(combo.key) && !combo.ctrl && !combo.alt) {
    throw new Error(`Shortcut "${keys}" needs Ctrl or Alt`);
  }
  return combo;
}

export function sameCombo(a: KeyCombo, b: KeyCombo): boolean {
  return a.key === b.key && a.ctrl === b.ctrl && a.alt === b.alt && a.shift === b.shift;
}

const RESERVED = BROWSER_KEYS.map(parse);

function isReserved(combo: KeyCombo): boolean {
  return (
    BROWSER_FUNCTION_KEYS.has(combo.key) || RESERVED.some((reserved) => sameCombo(reserved, combo))
  );
}

/** Parses `F2`, `Escape`, `?`, `/`, `Alt+H`, `Ctrl+Delete`, `Ctrl+Shift+K`, refusing the browser's own keys. */
export function parseKeys(keys: string): KeyCombo {
  const combo = parse(keys);
  if (isReserved(combo)) {
    throw new Error(`Shortcut "${keys}" belongs to the browser`);
  }
  return combo;
}

/**
 * Whether a keydown is this combo. Letters and digits compare the physical key, so Alt+H
 * works on a Hindi layout where the key types "ह". Modifiers must match exactly, so
 * Ctrl+Alt (AltGr on some layouts) never counts as Alt.
 */
export function matches(combo: KeyCombo, event: KeyboardEvent): boolean {
  // `/` (search) is the slash key by position too: Inscript types "य" there.
  const physical = /^(Key|Digit|Slash)/.test(combo.key);
  // "?" is also Shift+/ by position: on the Hindi Inscript layout that key types "य़".
  const question = combo.key === '?' && event.code === 'Slash' && event.shiftKey;
  if (!question && (physical ? event.code : event.key) !== combo.key) return false;
  // "?" needs Shift on most layouts and not on others, so Shift isn't part of it.
  const shiftOk = combo.key === '?' || combo.shift === event.shiftKey;
  return combo.ctrl === event.ctrlKey && combo.alt === event.altKey && shiftOk && !event.metaKey;
}

/** True when the keydown happened in a text field, where letters are typing, not commands. */
export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !==
      null
  );
}

/** The key chips to show: `Alt+H` → `['Alt', 'H']`. */
export function keyLabels(keys: string): string[] {
  return keys.split('+');
}

/**
 * True while a modal dialog is open. Every dialog here is a native `<dialog>` opened with
 * `showModal()` (ADR 0026), so `[open]` is enough; `:modal` would be exact in a browser but
 * jsdom's test polyfill can't set it.
 */
export function isModalOpen(): boolean {
  return document.querySelector('dialog[open]') !== null;
}
