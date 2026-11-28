import { afterEach, describe, expect, it, vi } from 'vitest';
import { printFrame } from './print-frame.js';

/**
 * A stand-in for the print frame's window: focusing it moves the page's focus onto the frame,
 * as a real iframe does, and `print` is whatever the test needs.
 */
function fakeFrame(print: () => void) {
  const element = document.createElement('iframe');
  document.body.append(element);
  const printSpy = vi.fn(print);
  return {
    element,
    print: printSpy,
    window: {
      focus: vi.fn(() => {
        element.focus();
      }),
      print: printSpy,
    } as unknown as Window,
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('printFrame', () => {
  it('prints the frame with the frame focused', () => {
    const frame = fakeFrame(() => {
      expect(document.activeElement).toBe(frame.element);
    });
    printFrame(frame.window);
    expect(frame.print).toHaveBeenCalledOnce();
  });

  // Found in the Chrome check (2026-11-28): after an auto-print the focus stayed on the hidden
  // frame, so the next scan and every counter key went nowhere.
  it('gives the focus back to where it was once the print returns', () => {
    const search = document.createElement('input');
    document.body.append(search);
    search.focus();
    const frame = fakeFrame(() => undefined);
    printFrame(frame.window);
    expect(document.activeElement).toBe(search);
  });

  it('gives the focus back even when printing fails', () => {
    const search = document.createElement('input');
    document.body.append(search);
    search.focus();
    const frame = fakeFrame(() => {
      throw new Error('printing refused');
    });
    expect(() => {
      printFrame(frame.window);
    }).toThrow('printing refused');
    expect(document.activeElement).toBe(search);
  });
});
