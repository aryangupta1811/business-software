import {
  Catch,
  HttpException,
  InternalServerErrorException,
  Logger,
  type ArgumentsHost,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { describeError } from './errors.js';

/**
 * Handles whatever a request throws that isn't one of Nest's HTTP errors. Nest's own filter
 * logs the error object, and for a failed query that prints the query's values and
 * PostgreSQL's `detail` line: customers' data in the logs (docs/devops/secrets.md). This one
 * logs the messages only and answers a plain 500.
 */
@Catch()
export class UnhandledErrorFilter extends BaseExceptionFilter {
  private readonly logger = new Logger('Api');

  override catch(exception: unknown, host: ArgumentsHost): void {
    if (exception instanceof HttpException) {
      super.catch(exception, host);
      return;
    }
    this.logger.error(`Request failed: ${describeError(exception)}`);
    super.catch(new InternalServerErrorException(), host);
  }
}
