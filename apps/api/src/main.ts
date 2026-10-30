// The api process: serves HTTP (ADR 0004).
import { Logger } from '@nestjs/common';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig(process.env);
const app = await createApp(config);
// 0.0.0.0 inside the container; compose.yaml publishes the port on 127.0.0.1 only.
await app.listen(config.port, '0.0.0.0');
new Logger('Api').log(`API listening on port ${String(config.port)}`);
