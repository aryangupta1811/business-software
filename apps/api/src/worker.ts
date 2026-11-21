// The worker process: same image as the api, runs background jobs (ADRs 0004, 0010, 0022).
import { Logger } from '@nestjs/common';
import { loadWorkerConfig } from './config.js';
import { runProcess } from './run.js';
import { waitForShutdown } from './shutdown.js';
import { createWorker } from './worker-app.js';

await runProcess('Worker', async () => {
  const worker = await createWorker(loadWorkerConfig(process.env));
  // pg-boss's polling keeps Node running, but the signal listeners are what end it cleanly.
  const signal = await waitForShutdown();
  new Logger('Worker').log(`Received ${signal}, shutting down`);
  await worker.close();
});
