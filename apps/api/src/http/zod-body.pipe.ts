import { BadRequestException, type PipeTransform } from '@nestjs/common';
import { fieldErrors } from '@business-software/shared';
import type { z } from 'zod';

/**
 * Parses a request body with its shared schema before any service sees it (ADR 0036). A bad
 * body answers 400 with one error code per field, which the web app translates.
 */
export class ZodBodyPipe<Schema extends z.ZodType> implements PipeTransform<
  unknown,
  z.infer<Schema>
> {
  constructor(readonly schema: Schema) {}

  transform(value: unknown): z.infer<Schema> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({ code: 'invalid_body', fields: fieldErrors(result.error) });
    }
    return result.data;
  }
}
