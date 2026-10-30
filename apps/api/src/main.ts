// The api process: serves HTTP (ADR 0004).
import { Logger } from '@nestjs/common';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { runProcess } from './run.js';
import { waitForShutdown } from './shutdown.js';

await runProcess('Api', async () => {
  const config = loadConfig(process.env);
  const app = await createApp(config);
  await app.listen(config.port, config.host);
  const logger = new Logger('Api');
  logger.log(`API listening on ${config.host}:${String(config.port)}`);

  // On SIGTERM (docker stop) or Ctrl+C: finish open requests, close the database pool, exit 0.
  // Nest's own enableShutdownHooks() would re-raise the signal, so the exit code would be 143.
  const signal = await waitForShutdown();
  logger.log(`Received ${signal}, shutting down`);
  await app.close();
});
