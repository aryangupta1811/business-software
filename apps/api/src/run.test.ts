import type { LoggerService } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runProcess } from './run.js';

function fakeLogger() {
  return { log: vi.fn(), error: vi.fn(), warn: vi.fn() } satisfies LoggerService;
}

describe('runProcess', () => {
  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it('logs a failure as one message line and exits with code 1', async () => {
    const logger = fakeLogger();
    const error = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
      client: { password: 's3cretpw' },
    });
    await runProcess('Worker', () => Promise.reject(error), logger);
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      'Worker failed: connect ECONNREFUSED 127.0.0.1:5432',
    );
    expect(process.exitCode).toBe(1);
  });

  // An 'error' event with no listener, or a promise nobody awaited, never reaches the catch
  // in runProcess. Node's default prints the whole error object: for a failed query, its values.
  it.each(['uncaughtException', 'unhandledRejection'] as const)(
    'logs an %s as one message line and exits with code 1',
    async (event) => {
      const logger = fakeLogger();
      const exit = vi.spyOn(process, 'exit').mockReturnValue(undefined as never);
      const listeners = () => process.listeners(event as 'uncaughtException');
      const before = listeners();
      let finish: () => void = () => undefined;
      const running = runProcess(
        'Api',
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
        logger,
      );

      const [crash, ...others] = listeners().filter((listener) => !before.includes(listener));
      expect(others).toEqual([]);
      // Called directly: emitting the event would also reach Vitest's own listener.
      crash?.(new Error('Failed query: select 1\nparams: fake-customer-value'), event);
      expect(logger.error).toHaveBeenCalledExactlyOnceWith('Api crashed: Failed query: select 1');
      expect(exit).toHaveBeenCalledExactlyOnceWith(1);

      finish();
      await running;
      expect(listeners()).toEqual(before);
    },
  );

  it('leaves the exit code alone when the process finishes normally', async () => {
    const logger = fakeLogger();
    await runProcess('Migrate', () => Promise.resolve(), logger);
    expect(logger.error).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });
});
