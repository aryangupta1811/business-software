import { Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import {
  billListQuerySchema,
  type BillDetailView,
  type BillListPage,
  type BillListQuery,
  type ReprintView,
} from '@business-software/shared';
import { CurrentCaller, Permission } from '../http/permission.decorator.js';
import type { Caller } from '../http/session.js';
import { UuidPipe } from '../http/uuid.pipe.js';
import { ZodBodyPipe } from '../http/zod-body.pipe.js';
import { BillsReadService } from './bills-read.service.js';

/** The Bills page and printing (P1.15; `02` #32): who sees which bills is in the service. */
@Controller('bills')
export class BillsReadController {
  constructor(@Inject(BillsReadService) private readonly bills: BillsReadService) {}

  @Permission('billing.sell')
  @Get()
  list(
    @CurrentCaller() caller: Caller,
    @Query(new ZodBodyPipe(billListQuerySchema)) query: BillListQuery,
  ): Promise<BillListPage> {
    return this.bills.list(caller, query);
  }

  @Permission('billing.sell')
  @Get(':id')
  one(@CurrentCaller() caller: Caller, @Param('id', UuidPipe) id: string): Promise<BillDetailView> {
    return this.bills.one(caller, id);
  }

  /** A copy was printed again: logged, and answered with the moment for the "Reprint" line. */
  @Permission('billing.sell')
  @Post(':id/reprints')
  reprint(
    @CurrentCaller() caller: Caller,
    @Param('id', UuidPipe) id: string,
  ): Promise<ReprintView> {
    return this.bills.reprint(caller, id);
  }
}
