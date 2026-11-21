import { renderHook } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { useScanner } from './scan';

/** Types `code` and Enter into `target` in one go, as a scanner does. */
function scan(code: string, target: HTMLElement = document.body) {
  for (const key of [...Array.from(code), 'Enter']) {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  }
}

test('a scan with nothing focused is handed to the page', () => {
  const onScan = vi.fn();
  renderHook(() => {
    useScanner(onScan);
  });
  scan('8901234567890');
  expect(onScan).toHaveBeenCalledExactlyOnceWith('8901234567890');
});

test('a scan into a text field is that field’s own typing', () => {
  const onScan = vi.fn();
  renderHook(() => {
    useScanner(onScan);
  });
  const input = document.body.appendChild(document.createElement('input'));
  scan('8901234567890', input);
  expect(onScan).not.toHaveBeenCalled();
  input.remove();
});

test('a scan while a modal dialog is open is not the page’s', () => {
  const onScan = vi.fn();
  renderHook(() => {
    useScanner(onScan);
  });
  const dialog = document.body.appendChild(document.createElement('dialog'));
  const button = dialog.appendChild(document.createElement('button'));
  dialog.showModal();
  scan('8901234567890', button);
  expect(onScan).not.toHaveBeenCalled();
  dialog.close();
  scan('8901234567890');
  expect(onScan).toHaveBeenCalledOnce();
  dialog.remove();
});

test('the keys of a burst never reach the shortcuts, so a / inside a code moves no focus', () => {
  renderHook(() => {
    useScanner(vi.fn());
  });
  const reached: string[] = [];
  const listener = (event: KeyboardEvent) => reached.push(event.key);
  window.addEventListener('keydown', listener);
  scan('12/34');
  window.removeEventListener('keydown', listener);
  // Only the first key of the burst (before a burst exists) gets through.
  expect(reached).toEqual(['1']);
});

test('the latest onScan is used without listening again', () => {
  const first = vi.fn();
  const second = vi.fn();
  const { rerender } = renderHook(
    ({ onScan }) => {
      useScanner(onScan);
    },
    { initialProps: { onScan: first } },
  );
  rerender({ onScan: second });
  scan('8901234567890');
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledOnce();
});

test('it stops listening when the page goes away', () => {
  const onScan = vi.fn();
  const { unmount } = renderHook(() => {
    useScanner(onScan);
  });
  unmount();
  scan('8901234567890');
  expect(onScan).not.toHaveBeenCalled();
});
