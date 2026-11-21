import { useEffect, useRef } from 'react';
import { isModalOpen } from '../shortcuts/keys';

/** A scanner types a whole code in a few milliseconds; a person takes far longer per key. */
export const SCAN_GAP_MS = 50;
const MIN_LENGTH = 4;
const PRINTABLE = /^[!-~]$/;

/**
 * Tells a scanner's burst from typing (ADR 0026: scanners type like a keyboard). Each key
 * arriving more than `SCAN_GAP_MS` after the last starts a new burst, so only a burst of at
 * least four printable characters ended by Enter counts as a scan.
 */
export class ScanBuffer {
  #code = '';
  #last = Number.NEGATIVE_INFINITY;

  /** True when a key at `at` continues a burst already started: it belongs to the scan. */
  inBurst(at: number): boolean {
    return this.#code !== '' && at - this.#last <= SCAN_GAP_MS;
  }

  /** Feeds one key pressed at `at` milliseconds; returns the code when a scan ends. */
  key(key: string, at: number): string | null {
    // A scanner presses Shift for capital letters; Shift itself prints nothing.
    if (key === 'Shift') return null;
    if (at - this.#last > SCAN_GAP_MS) this.#code = '';
    this.#last = at;
    if (key === 'Enter') {
      const code = this.#code;
      this.#code = '';
      return code.length >= MIN_LENGTH ? code : null;
    }
    this.#code = PRINTABLE.test(key) ? this.#code + key : '';
    return null;
  }
}

// Inputs a person types text into. A checkbox, radio, button or select doesn't take text, so a
// scan made while one has focus (just after ticking a filter) is still a scan.
const TEXT_INPUT_TYPES = new Set([
  '',
  'text',
  'search',
  'email',
  'tel',
  'url',
  'number',
  'password',
]);

/** True for a field a scanner's typing goes into as text. */
export function isTextEntry(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement) {
    return TEXT_INPUT_TYPES.has(target.getAttribute('type')?.toLowerCase() ?? '');
  }
  if (target instanceof HTMLTextAreaElement) return true;
  return (
    target instanceof Element &&
    target.closest('[contenteditable]:not([contenteditable="false"])') !== null
  );
}

/**
 * Calls `onScan` with the code of a scan made while no text field has focus, so a page can send
 * it to its search box (or straight to the item) however the cashier's focus got lost. A scan
 * into a field is that field's own typing, and one made while a modal dialog is open belongs to
 * the dialog, so both are left alone. The keys of a burst never reach the page's shortcuts.
 */
export function useScanner(onScan: (code: string) => void): void {
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  });
  useEffect(() => {
    const buffer = new ScanBuffer();
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextEntry(event.target) || event.ctrlKey || event.altKey || event.metaKey) return;
      if (isModalOpen()) return;
      // A key in the middle of a burst is part of the code: `/` or `?` there must not reach
      // the shortcuts (listening on window after this) and move focus mid-scan.
      if (buffer.inBurst(event.timeStamp)) event.stopPropagation();
      const code = buffer.key(event.key, event.timeStamp);
      if (code === null) return;
      event.preventDefault();
      onScanRef.current(code);
    };
    // Capture, so this runs before the shortcut registry's own window listener.
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
    };
  }, []);
}
