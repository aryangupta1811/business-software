import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import {
  holdBillSchema,
  type HeldBillView,
  type HoldBillInput,
  type ResumedBillView,
} from '@business-software/shared';
import { CurrentCaller, Permission } from '../http/permission.decorator.js';
import type { Caller } from '../http/session.js';
import { UuidPipe } from '../http/uuid.pipe.js';
import { ZodBodyPipe } from '../http/zod-body.pipe.js';
import { HeldBillsService } from './held-bills.service.js';

/** Held bills of the caller's branch (P1.13 design §9). Everything here needs `billing.sell`. */
@Controller('held-bills')
export class HeldBillsController {
  constructor(@Inject(HeldBillsService) private readonly held: HeldBillsService) {}

  @Permission('billing.sell')
  @Get()
  list(@CurrentCaller() caller: Caller): Promise<HeldBillView[]> {
    return this.held.list(caller);
  }

  @Permission('billing.sell')
  @Post()
  hold(
    @CurrentCaller() caller: Caller,
    @Body(new ZodBodyPipe(holdBillSchema)) body: HoldBillInput,
  ): Promise<HeldBillView> {
    return this.held.hold(caller, body);
  }

  @Permission('billing.sell')
  @Post(':id/resume')
  @HttpCode(200)
  resume(
    @CurrentCaller() caller: Caller,
    @Param('id', UuidPipe) id: string,
  ): Promise<ResumedBillView> {
    return this.held.resume(caller, id);
  }

  @Permission('billing.sell')
  @Post(':id/discard')
  @HttpCode(200)
  discard(
    @CurrentCaller() caller: Caller,
    @Param('id', UuidPipe) id: string,
  ): Promise<{ billKey: string }> {
    return this.held.discard(caller, id);
  }
}
