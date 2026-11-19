import { fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ACTIVE_PING_MS, IDLE_GRACE_MS } from '@business-software/shared';
import { useIdle } from './use-idle';

const MINUTE = 60_000;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function watch(minutes: number, enabled = true) {
  const onIdle = vi.fn();
  const onActive = vi.fn();
  const hook = renderHook(
    (props: { enabled: boolean }) => {
      useIdle({ minutes, enabled: props.enabled, onIdle, onActive });
    },
    { initialProps: { enabled } },
  );
  return { onIdle, onActive, hook };
}

test('calls onIdle once the minutes pass with no key, click, scroll or touch', () => {
  const { onIdle } = watch(5);
  vi.advanceTimersByTime(5 * MINUTE - 1);
  expect(onIdle).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(onIdle).toHaveBeenCalledOnce();
});

test('starts counting again on each key or click, but not on mouse movement', () => {
  const { onIdle } = watch(5);
  vi.advanceTimersByTime(4 * MINUTE);
  fireEvent.keyDown(window, { key: 'a' });
  vi.advanceTimersByTime(4 * MINUTE);
  fireEvent.pointerDown(window);
  vi.advanceTimersByTime(4 * MINUTE);
  fireEvent.mouseMove(window);
  expect(onIdle).not.toHaveBeenCalled();
  vi.advanceTimersByTime(MINUTE);
  expect(onIdle).toHaveBeenCalledOnce();
});

test('tells the server at once on the first key press, then at most every 30 seconds', () => {
  const { onActive } = watch(5);
  // A page that just loaded isn't activity; the first key press after it is.
  expect(onActive).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: 'a' });
  expect(onActive).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(ACTIVE_PING_MS - 1);
  fireEvent.keyDown(window, { key: 'b' });
  expect(onActive).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(1);
  fireEvent.keyDown(window, { key: 'c' });
  expect(onActive).toHaveBeenCalledTimes(2);
});

// The 5-minute case: the server hears of the last key press at most ACTIVE_PING_MS late and
// waits IDLE_GRACE_MS longer than the screen (packages/shared), so the screen locks first.
test('locks 5 minutes after the last key press, however long after the last ping', () => {
  const { onIdle, onActive } = watch(5);
  fireEvent.keyDown(window, { key: 'a' });
  vi.advanceTimersByTime(ACTIVE_PING_MS - 1);
  fireEvent.keyDown(window, { key: 'b' });
  expect(onActive).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(5 * MINUTE - 1);
  expect(onIdle).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(onIdle).toHaveBeenCalledOnce();
  expect(ACTIVE_PING_MS + 5 * MINUTE).toBeLessThan(5 * MINUTE + IDLE_GRACE_MS);
});

test('does nothing while switched off (a locked screen)', () => {
  const { onIdle, onActive, hook } = watch(5, false);
  fireEvent.keyDown(window, { key: 'a' });
  vi.advanceTimersByTime(60 * MINUTE);
  expect(onIdle).not.toHaveBeenCalled();
  expect(onActive).not.toHaveBeenCalled();
  hook.rerender({ enabled: true });
  vi.advanceTimersByTime(5 * MINUTE);
  expect(onIdle).toHaveBeenCalledOnce();
});
