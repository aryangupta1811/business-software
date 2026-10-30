import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { expect, it } from 'vitest';

const shutdownModule = new URL('./shutdown.ts', import.meta.url).href;

// Bug found in the first Docker run: once the database pool closed its idle connection,
// nothing kept Node running, so the worker exited mid-wait and Docker restarted it.
// The child process runs shutdown.ts on its own (Node strips its types), with nothing
// else holding it open.
it('keeps the process running until a stop signal arrives', async () => {
  const child = spawn(process.execPath, [
    '--input-type=module',
    '-e',
    `import { waitForShutdown } from '${shutdownModule}'; await waitForShutdown();`,
  ]);
  try {
    await sleep(1_000);
    expect(child.exitCode).toBeNull();
  } finally {
    child.kill();
  }
});
