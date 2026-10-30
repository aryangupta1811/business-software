// The worker process: same image as the api, runs background jobs (ADRs 0004, 0010).
import { Logger } from '@nestjs/common';
import { loadConfig } from './config.js';
import { runProcess } from './run.js';
import { waitForShutdown } from './shutdown.js';
import { createWorker } from './worker-app.js';

await runProcess('Worker', async () => {
  const worker = await createWorker(loadConfig(process.env));
  // A Nest context holds no server, so the worker waits here until it's told to stop.
  const signal = await waitForShutdown();
  new Logger('Worker').log(`Received ${signal}, shutting down`);
  await worker.close();
});
