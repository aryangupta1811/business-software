import type { ParseKeys } from 'i18next';
import {
  isFunctionOrEscape,
  isTypingTarget,
  matches,
  parseKeys,
  sameCombo,
  type KeyCombo,
} from './keys';

export type ShortcutGroup = 'general' | 'navigation';

export interface Shortcut {
  keys: string;
  /** Translation key of what the shortcut does, shown in the help panel. */
  description: ParseKeys;
  group: ShortcutGroup;
  action: () => void;
}

/** The shortcuts that work right now. Components add theirs while they're on screen. */
export class ShortcutRegistry {
  #entries: { shortcut: Shortcut; combo: KeyCombo }[] = [];
  #active: readonly Shortcut[] = [];
  #listeners = new Set<() => void>();
  #paused = false;

  register(shortcut: Shortcut): () => void {
    const combo = parseKeys(shortcut.keys);
    if (this.#entries.some((entry) => sameCombo(entry.combo, combo))) {
      throw new Error(`Shortcut "${shortcut.keys}" is already registered`);
    }
    const entry = { shortcut, combo };
    this.#entries.push(entry);
    this.#changed();
    return () => {
      this.#entries = this.#entries.filter((other) => other !== entry);
      this.#changed();
    };
  }

  /** The same array until something changes, as useSyncExternalStore needs. */
  active(): readonly Shortcut[] {
    return this.#active;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** While paused (the help panel is open), no shortcut fires. */
  setPaused(paused: boolean): void {
    this.#paused = paused;
  }

  /** Runs the matching shortcut's action; true if one ran. */
  handle(event: KeyboardEvent): boolean {
    // A held key repeats, and an IME sends keys while it builds a word: neither is a command.
    if (this.#paused || event.repeat || event.isComposing) return false;
    const typing = isTypingTarget(event.target);
    const entry = this.#entries.find(
      ({ combo }) =>
        matches(combo, event) &&
        !(typing && !combo.ctrl && !combo.alt && !isFunctionOrEscape(combo.key)),
    );
    entry?.shortcut.action();
    return entry !== undefined;
  }

  #changed() {
    this.#active = this.#entries.map(({ shortcut }) => shortcut);
    for (const listener of this.#listeners) listener();
  }
}
