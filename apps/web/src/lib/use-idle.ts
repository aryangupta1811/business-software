import { useEffect, useRef } from 'react';

/** What counts as someone at the counter. Mouse movement alone doesn't: a bumped mouse isn't use. */
const ACTIVITY = ['keydown', 'pointerdown', 'wheel', 'touchstart'] as const;

/** How often, at most, the server hears that someone is still at the counter. */
export const ACTIVE_PING_MS = 30_000;

/**
 * Calls `onIdle` once after `minutes` with no key, click, scroll or touch (Module 00 #21, #29),
 * and `onActive` at most every 30 seconds while there is some, so the server's idle clock
 * follows the person and not only the requests (typing a long bill sends none).
 */
export function useIdle({
  minutes,
  enabled,
  onIdle,
  onActive,
}: {
  minutes: number;
  enabled: boolean;
  onIdle: () => void;
  onActive: () => void;
}): void {
  const callbacks = useRef({ onIdle, onActive });
  useEffect(() => {
    callbacks.current = { onIdle, onActive };
  });

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastPing = Date.now();
    const startTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        callbacks.current.onIdle();
      }, minutes * 60_000);
    };
    const onActivity = () => {
      startTimer();
      if (Date.now() - lastPing >= ACTIVE_PING_MS) {
        lastPing = Date.now();
        callbacks.current.onActive();
      }
    };
    startTimer();
    for (const event of ACTIVITY) window.addEventListener(event, onActivity, { passive: true });
    return () => {
      clearTimeout(timer);
      for (const event of ACTIVITY) window.removeEventListener(event, onActivity);
    };
  }, [minutes, enabled]);
}
