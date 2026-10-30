import type { LoggerService } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runProcess } from './run.js';

function fakeLogger() {
  return { log: vi.fn(), error: vi.fn(), warn: vi.fn() } satisfies LoggerService;
}

describe('runProcess', () => {
  afterEach(() => {
    process.exitCode = undefined;
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

  it('leaves the exit code alone when the process finishes normally', async () => {
    const logger = fakeLogger();
    await runProcess('Migrate', () => Promise.resolve(), logger);
    expect(logger.error).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });
});
