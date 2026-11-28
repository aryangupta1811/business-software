import { describe, expect, it, vi } from 'vitest';
import type { EnsureOptions, EnsureResult } from './reset.js';
import { resetDemoOnStart } from './worker-reset.js';

const kept: EnsureResult = { action: 'kept', businessId: 'b', ageDays: 1 };
const url = 'postgresql://app_runtime:pw@127.0.0.1:5432/business_software';

describe('the worker demo reset', () => {
  it('does nothing on a server that is not the demo', async () => {
    const run = vi.fn<(options: EnsureOptions) => Promise<EnsureResult>>(() =>
      Promise.resolve(kept),
    );
    await resetDemoOnStart({ databaseUrl: url }, run);
    await resetDemoOnStart({ databaseUrl: url, demoEnabled: false }, run);
    expect(run).not.toHaveBeenCalled();
  });

  it('asks for the weekly check on the demo server, and does not force one', async () => {
    const run = vi.fn<(options: EnsureOptions) => Promise<EnsureResult>>(() =>
      Promise.resolve(kept),
    );
    await resetDemoOnStart({ databaseUrl: url, demoEnabled: true }, run);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ databaseUrl: url }));
    expect(run.mock.calls[0]?.[0]).not.toHaveProperty('force');
  });

  it('swallows a failure, so the worker still starts', async () => {
    const run = vi.fn<(options: EnsureOptions) => Promise<EnsureResult>>(() =>
      Promise.reject(new Error('database is down')),
    );
    await expect(
      resetDemoOnStart({ databaseUrl: url, demoEnabled: true }, run),
    ).resolves.toBeUndefined();
  });
});
