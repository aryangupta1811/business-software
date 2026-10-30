/**
 * Resolves with the signal's name when Docker (SIGTERM) or Ctrl+C (SIGINT) asks to stop.
 *
 * Signal listeners don't keep Node running: once nothing else is pending (the database pool
 * closes idle connections after 10 s), Node would exit mid-wait. The timer holds it open.
 */
export function waitForShutdown(): Promise<string> {
  return new Promise((resolve) => {
    // The longest delay a Node timer allows (about 24.8 days); it's cleared on the signal.
    const keepAlive = setInterval(() => undefined, 2 ** 31 - 1);
    const stop = (signal: string) => {
      clearInterval(keepAlive);
      process.off('SIGTERM', stop);
      process.off('SIGINT', stop);
      resolve(signal);
    };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
  });
}
