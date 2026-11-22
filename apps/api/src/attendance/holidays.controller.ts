// The shop holiday calendar (P2.3 design section 5; Module 05 #7, #31): Settings, owner only.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import {
  holidaySchema,
  holidaysQuerySchema,
  removeHolidaySchema,
  type HolidayInput,
  type HolidaysQuery,
  type HolidayView,
  type RemoveHolidayInput,
} from '@business-software/shared';
import { CurrentCaller, Permission } from '../http/permission.decorator.js';
import type { Caller } from '../http/session.js';
import { UuidPipe } from '../http/uuid.pipe.js';
import { ZodBodyPipe } from '../http/zod-body.pipe.js';
import { HolidaysService } from './holidays.service.js';

@Controller('holidays')
export class HolidaysController {
  constructor(@Inject(HolidaysService) private readonly holidays: HolidaysService) {}

  @Permission('settings.view')
  @Get()
  list(
    @CurrentCaller() caller: Caller,
    @Query(new ZodBodyPipe(holidaysQuerySchema)) query: HolidaysQuery,
  ): Promise<HolidayView[]> {
    return this.holidays.list(caller, query);
  }

  @Permission('settings.manage')
  @Post()
  add(
    @CurrentCaller() caller: Caller,
    @Body(new ZodBodyPipe(holidaySchema)) body: HolidayInput,
  ): Promise<HolidayView> {
    return this.holidays.add(caller, body);
  }

  /** Archives it, with an optional reason: it is never deleted (ADR 0007). */
  @Permission('settings.manage')
  @Post(':id/remove')
  @HttpCode(200)
  remove(
    @CurrentCaller() caller: Caller,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodBodyPipe(removeHolidaySchema)) body: RemoveHolidayInput,
  ): Promise<HolidayView> {
    return this.holidays.remove(caller, id, body.reason);
  }
}
