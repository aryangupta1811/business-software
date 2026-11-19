import { NotFoundException, type PipeTransform } from '@nestjs/common';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An ID in the path. Anything that isn't a UUID can't name a row, so it answers 404 like an
 * unknown ID, instead of reaching PostgreSQL as a cast error (a 500).
 */
export class UuidPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!UUID.test(value)) throw new NotFoundException({ code: 'not_found' });
    return value.toLowerCase();
  }
}
