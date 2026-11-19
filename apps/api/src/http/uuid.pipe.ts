import { NotFoundException, type PipeTransform } from '@nestjs/common';
import { isUuid } from '@business-software/shared';

/**
 * An ID in the path. Anything that isn't a UUID can't name a row, so it answers 404 like an
 * unknown ID, instead of reaching PostgreSQL as a cast error (a 500).
 */
export class UuidPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!isUuid(value)) throw new NotFoundException({ code: 'not_found' });
    return value.toLowerCase();
  }
}
