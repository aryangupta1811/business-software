import {
  Catch,
  HttpException,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
  type ArgumentsHost,
} from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import { BaseExceptionFilter } from '@nestjs/core';
import { describeError } from './errors.js';

/**
 * Handles whatever a request throws that isn't one of Nest's HTTP errors. Nest's own filter
 * logs the error object, and for a failed query that prints the query's values and
 * PostgreSQL's `detail` line: customers' data in the logs (docs/devops/secrets.md). This one
 * logs the messages only and answers a plain 500.
 *
 * A query that waited past `lock_timeout` (55P03, ADR 0041) is an answer, not a failure:
 * another counter held the row. It gets `503 busy` with `Retry-After: 1`, and a warning.
 */
@Catch()
export class UnhandledErrorFilter extends BaseExceptionFilter {
  private readonly logger = new Logger('Api');

  override catch(exception: unknown, host: ArgumentsHost): void {
    if (exception instanceof HttpException) {
      super.catch(exception, host);
      return;
    }
    if (isLockTimeout(exception)) {
      this.logger.warn(`Request busy: ${describeError(exception)}`);
      host.switchToHttp().getResponse<ServerResponse>().setHeader('Retry-After', '1');
      super.catch(new ServiceUnavailableException({ code: 'busy' }), host);
      return;
    }
    this.logger.error(`Request failed: ${describeError(exception)}`);
    super.catch(new InternalServerErrorException(), host);
  }
}

/** PostgreSQL's lock_not_available, on the error or (as Drizzle wraps it) on its cause. */
function isLockTimeout(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; depth < 5; depth += 1) {
    if (typeof current !== 'object' || current === null) return false;
    if ((current as { code?: unknown }).code === '55P03') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
