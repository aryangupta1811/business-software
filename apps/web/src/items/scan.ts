import { useEffect, useRef } from 'react';
import { isTypingTarget } from '../shortcuts/keys';

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

/**
 * Calls `onScan` for a scan made while no field has focus. A scan into a field (the search
 * box) is that field's own typing, so it's left alone.
 */
export function useScanner(onScan: (code: string) => void): void {
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  });
  useEffect(() => {
    const buffer = new ScanBuffer();
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || event.ctrlKey || event.altKey || event.metaKey) return;
      const code = buffer.key(event.key, event.timeStamp);
      if (code === null) return;
      event.preventDefault();
      onScanRef.current(code);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}
