import { BadRequestException, type PipeTransform } from '@nestjs/common';
import { isCalendarDate } from '@business-software/shared';

/** A calendar day in the path (`2026-11-22`); anything else is a 400 the screen can show. */
export class DatePipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!isCalendarDate(value)) {
      throw new BadRequestException({ code: 'invalid_body', fields: { date: 'invalid' } });
    }
    return value;
  }
}
