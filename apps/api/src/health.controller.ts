import { Controller, Get, Inject, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { Database } from '@business-software/db';
import { DATABASE } from './database.module.js';
import { describeError } from './errors.js';

/**
 * Liveness (`/health`): the process answers, so there's no reason to restart it.
 * Readiness (`/health/ready`): it can also reach the database, so it can serve requests.
 */
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(@Inject(DATABASE) private readonly database: Database) {}

  @Get()
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<{ status: 'ok'; database: 'ok' }> {
    try {
      await this.database.pool.query('select 1');
    } catch (error) {
      this.logger.warn(`Database unreachable: ${describeError(error)}`);
      throw new ServiceUnavailableException({ status: 'error', database: 'unreachable' });
    }
    return { status: 'ok', database: 'ok' };
  }
}
