import { Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import type { AlertList } from '@business-software/shared';
import { CurrentCaller, Permission } from '../http/permission.decorator.js';
import type { Caller } from '../http/session.js';
import { UuidPipe } from '../http/uuid.pipe.js';
import { AlertsService } from './alerts.service.js';

/** The bell (P2.7). Every logged-in person has one; what it shows depends on their permissions. */
@Controller('alerts')
export class AlertsController {
  constructor(@Inject(AlertsService) private readonly alerts: AlertsService) {}

  @Permission('session.own')
  @Get()
  list(@CurrentCaller() caller: Caller): Promise<AlertList> {
    return this.alerts.list(caller);
  }

  @Permission('session.own')
  @HttpCode(204)
  @Post(':id/dismiss')
  dismiss(@CurrentCaller() caller: Caller, @Param('id', UuidPipe) id: string): Promise<void> {
    return this.alerts.dismiss(caller, id);
  }
}
