import { fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ACTIVE_PING_MS, useIdle } from './use-idle';

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

test('tells the server at most every 30 seconds that someone is there', () => {
  const { onActive } = watch(5);
  fireEvent.keyDown(window, { key: 'a' });
  expect(onActive).not.toHaveBeenCalled();
  vi.advanceTimersByTime(ACTIVE_PING_MS);
  fireEvent.keyDown(window, { key: 'b' });
  fireEvent.keyDown(window, { key: 'c' });
  expect(onActive).toHaveBeenCalledOnce();
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
