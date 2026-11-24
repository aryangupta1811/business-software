/**
 * Prints a frame's page. Its own module so tests can stand in for it: jsdom cannot print, and
 * the tests only need to see what the frame holds at that moment.
 */
export function printFrame(frame: Window): void {
  frame.focus();
  frame.print();
}
