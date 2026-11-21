import type { ParseKeys } from 'i18next';
import {
  isFunctionOrEscape,
  isModalOpen,
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
  /**
   * For keys that belong to a dialog: they work only while a modal dialog is open (and the
   * page's own shortcuts are off). Register them from a component rendered inside the dialog.
   */
  inDialog?: boolean | undefined;
}

export interface RegistryOptions {
  /**
   * What a clash does: throw (so a developer sees it at once) or warn and keep the first
   * (so a shop's counter never breaks on a mistake). Defaults to throwing in development and tests.
   */
  throwOnClash?: boolean;
}

/** The shortcuts that work right now. Components add theirs while they're on screen. */
export class ShortcutRegistry {
  #entries: { shortcut: Shortcut; combo: KeyCombo }[] = [];
  #active: readonly Shortcut[] = [];
  #listeners = new Set<() => void>();
  #paused = false;
  readonly #throwOnClash: boolean;

  constructor({ throwOnClash = import.meta.env.DEV }: RegistryOptions = {}) {
    this.#throwOnClash = throwOnClash;
  }

  register(shortcut: Shortcut): () => void {
    const combo = parseKeys(shortcut.keys);
    const inDialog = shortcut.inDialog === true;
    const clash = this.#entries.some(
      (entry) => (entry.shortcut.inDialog === true) === inDialog && sameCombo(entry.combo, combo),
    );
    if (clash) {
      const message = `Shortcut "${shortcut.keys}" is already registered`;
      if (this.#throwOnClash) throw new Error(message);
      console.warn(`${message}; keeping the first`);
      return () => undefined;
    }
    const entry = { shortcut, combo };
    this.#entries.push(entry);
    this.#changed();
    return () => {
      this.#entries = this.#entries.filter((other) => other !== entry);
      this.#changed();
    };
  }

  /** The page's shortcuts: the same array until something changes, as useSyncExternalStore needs. */
  active(): readonly Shortcut[] {
    return this.#active;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** While paused (the lock screen), no shortcut fires. */
  setPaused(paused: boolean): void {
    this.#paused = paused;
  }

  /**
   * Runs the shortcut this keydown is, and keeps the browser from also acting on it; true if one
   * ran. While a dialog is open, only the dialog's own shortcuts (`inDialog`) run, and while
   * paused none do.
   */
  handle(event: KeyboardEvent): boolean {
    // A field that handled the key itself has said it isn't a command; an IME sends keys while
    // it builds a word, and cancelling those would break the word.
    if (event.defaultPrevented || event.isComposing) return false;
    const typing = isTypingTarget(event.target);
    const modal = isModalOpen();
    const ours = this.#entries.filter(
      ({ combo }) =>
        matches(combo, event) &&
        !(typing && !combo.ctrl && !combo.alt && !isFunctionOrEscape(combo.key)),
    );
    if (ours.length === 0) return false;
    // A held key repeats: it isn't a new command.
    const runnable =
      this.#paused || event.repeat
        ? undefined
        : ours.find(({ shortcut }) => (shortcut.inDialog === true) === modal);
    // Our key, even when ignored: Chrome must not get a held F3 (find) or an F10 pressed over a
    // dialog. Escape is the exception, so it can still close the dialog.
    if (runnable || !(event.key === 'Escape' && (modal || this.#paused))) event.preventDefault();
    runnable?.shortcut.action();
    return runnable !== undefined;
  }

  #changed() {
    this.#active = this.#entries
      .map(({ shortcut }) => shortcut)
      .filter((shortcut) => shortcut.inDialog !== true);
    for (const listener of this.#listeners) listener();
  }
}
