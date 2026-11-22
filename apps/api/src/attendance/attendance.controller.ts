// The attendance register and a person's month (P2.3 design section 5; Module 05 #5–#9, #25,
// #26). The register needs `attendance.mark`; a month is always the caller's own, and anyone
// else's needs `attendance.view_all` (checked by the service, which knows whose month it is).
import { Body, Controller, Get, Inject, Param, Put, Query } from '@nestjs/common';
import {
  attendanceMarkSchema,
  monthQuerySchema,
  registerQuerySchema,
  type AttendanceMarkInput,
  type MonthQuery,
  type MonthView,
  type RegisterQuery,
  type RegisterRow,
  type RegisterView,
} from '@business-software/shared';
import { CurrentCaller, Permission } from '../http/permission.decorator.js';
import type { Caller } from '../http/session.js';
import { DatePipe } from '../http/date.pipe.js';
import { UuidPipe } from '../http/uuid.pipe.js';
import { ZodBodyPipe } from '../http/zod-body.pipe.js';
import { AttendanceService } from './attendance.service.js';

@Controller('attendance')
export class AttendanceController {
  constructor(@Inject(AttendanceService) private readonly attendance: AttendanceService) {}

  @Permission('attendance.mark')
  @Get()
  register(
    @CurrentCaller() caller: Caller,
    @Query(new ZodBodyPipe(registerQuerySchema)) query: RegisterQuery,
  ): Promise<RegisterView> {
    return this.attendance.register(caller, query);
  }

  /** One person's month; whose month, and so who may see it, is the service's to say. */
  @Permission('session.own')
  @Get('month')
  month(
    @CurrentCaller() caller: Caller,
    @Query(new ZodBodyPipe(monthQuerySchema)) query: MonthQuery,
  ): Promise<MonthView> {
    return this.attendance.month(caller, query);
  }

  @Permission('attendance.mark')
  @Put(':userId/:date')
  mark(
    @CurrentCaller() caller: Caller,
    @Param('userId', UuidPipe) userId: string,
    @Param('date', DatePipe) date: string,
    @Body(new ZodBodyPipe(attendanceMarkSchema)) body: AttendanceMarkInput,
  ): Promise<RegisterRow> {
    return this.attendance.mark(caller, userId, date, body);
  }
}
