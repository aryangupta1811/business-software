// The worker process: same image as the api, runs background jobs (ADRs 0004, 0010, 0022).
import { Logger } from '@nestjs/common';
import { loadWorkerConfig } from './config.js';
import { resetDemoOnStart } from './demo/worker-reset.js';
import { runProcess } from './run.js';
import { waitForShutdown } from './shutdown.js';
import { createWorker } from './worker-app.js';

await runProcess('Worker', async () => {
  const config = loadWorkerConfig(process.env);
  const worker = await createWorker(config);
  // On the demo server only: a new demo shop if the newest is a week old (runs in the background).
  void resetDemoOnStart(config);
  // pg-boss's polling keeps Node running, but the signal listeners are what end it cleanly.
  const signal = await waitForShutdown();
  new Logger('Worker').log(`Received ${signal}, shutting down`);
  await worker.close();
});
