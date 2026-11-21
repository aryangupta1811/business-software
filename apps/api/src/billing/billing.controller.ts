import { Body, Controller, Get, HttpCode, Inject, Post, Query } from '@nestjs/common';
import {
  approvalSchema,
  catalogueQuerySchema,
  discardBillSchema,
  type ApprovalInput,
  type ApprovalView,
  type CatalogueQuery,
  type CatalogueView,
  type DiscardBillInput,
} from '@business-software/shared';
import { answer } from '../auth/session.controller.js';
import { CurrentCaller, Permission } from '../http/permission.decorator.js';
import type { Caller } from '../http/session.js';
import { ZodBodyPipe } from '../http/zod-body.pipe.js';
import { BillingService } from './billing.service.js';

/** The billing counter (P1.13). Everything here needs `billing.sell`. */
@Controller('billing')
export class BillingController {
  constructor(@Inject(BillingService) private readonly billing: BillingService) {}

  /** The counter's copy of the catalogue, whole or since a time (design §4, ADR 0043). */
  @Permission('billing.sell')
  @Get('catalogue')
  catalogue(
    @CurrentCaller() caller: Caller,
    @Query(new ZodBodyPipe(catalogueQuerySchema)) query: CatalogueQuery,
  ): Promise<CatalogueView> {
    return this.billing.catalogue(caller, query);
  }

  /** A full open bill cleared without saving: logged (question 7). */
  @Permission('billing.sell')
  @Post('discard')
  @HttpCode(200)
  discard(
    @CurrentCaller() caller: Caller,
    @Body(new ZodBodyPipe(discardBillSchema)) body: DiscardBillInput,
  ): Promise<{ billKey: string }> {
    return this.billing.discard(caller, body);
  }

  /** The owner's OK for a discount above the cashier's limit (design §6). */
  @Permission('billing.sell')
  @Post('approvals')
  approve(
    @CurrentCaller() caller: Caller,
    @Body(new ZodBodyPipe(approvalSchema)) body: ApprovalInput,
  ): Promise<ApprovalView> {
    // A wrong password is 401 wrong_password, too many tries 429, as on every owner-password route.
    return answer(() => this.billing.approve(caller, body));
  }
}
