/**
 * Prints a frame's page. Its own module so tests can stand in for it: jsdom cannot print, and
 * the tests only need to see what the frame holds at that moment.
 *
 * The frame is focused to print, then the focus goes back to where it was: left on the hidden
 * frame, the next scan and every counter key would go nowhere (Chrome check, 2026-11-28).
 * Chrome's `print()` returns when its dialog closes; a browser whose dialog stays open after it
 * returns gets the focus back early, which does no harm.
 */
export function printFrame(frame: Window): void {
  const before = document.activeElement;
  frame.focus();
  try {
    frame.print();
  } finally {
    if (before instanceof HTMLElement && before !== document.body) before.focus();
    else window.focus();
  }
}
