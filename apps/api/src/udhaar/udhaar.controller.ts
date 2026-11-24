import { Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import {
  udhaarCustomersQuerySchema,
  udhaarLedgerQuerySchema,
  udhaarOpeningSchema,
  udhaarPaymentSchema,
  udhaarReversalSchema,
  type UdhaarCustomersQuery,
  type UdhaarCustomersView,
  type UdhaarLedgerQuery,
  type UdhaarLedgerView,
  type UdhaarMoveView,
  type UdhaarOpeningInput,
  type UdhaarPaymentInput,
  type UdhaarReversalInput,
} from '@business-software/shared';
import { answer } from '../auth/session.controller.js';
import { CurrentCaller, Permission } from '../http/permission.decorator.js';
import type { Caller } from '../http/session.js';
import { UuidPipe } from '../http/uuid.pipe.js';
import { ZodBodyPipe } from '../http/zod-body.pipe.js';
import { UdhaarService } from './udhaar.service.js';

/** The udhaar ledger (P1.18 design §6). Reading needs `customers.view`. */
@Controller('udhaar')
export class UdhaarController {
  constructor(@Inject(UdhaarService) private readonly udhaar: UdhaarService) {}

  @Permission('customers.view')
  @Get('customers')
  customers(
    @CurrentCaller() caller: Caller,
    @Query(new ZodBodyPipe(udhaarCustomersQuerySchema)) query: UdhaarCustomersQuery,
  ): Promise<UdhaarCustomersView> {
    return this.udhaar.customers(caller, query);
  }

  @Permission('customers.view')
  @Get('customers/:id')
  ledger(
    @CurrentCaller() caller: Caller,
    @Param('id', UuidPipe) id: string,
    @Query(new ZodBodyPipe(udhaarLedgerQuerySchema)) query: UdhaarLedgerQuery,
  ): Promise<UdhaarLedgerView> {
    return this.udhaar.ledger(caller, id, query);
  }

  /** `03` #11, question 7: anyone who takes money for a sale can take money for udhaar. */
  @Permission('billing.sell')
  @Post('payments')
  record(
    @CurrentCaller() caller: Caller,
    @Body(new ZodBodyPipe(udhaarPaymentSchema)) body: UdhaarPaymentInput,
  ): Promise<UdhaarMoveView> {
    return this.udhaar.recordPayment(caller, body);
  }

  /** Owner only: `settings.manage` is a switch no staff login can hold (`03` #21). */
  @Permission('settings.manage')
  @Post('payments/:id/reverse')
  reverse(
    @CurrentCaller() caller: Caller,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodBodyPipe(udhaarReversalSchema)) body: UdhaarReversalInput,
  ): Promise<UdhaarMoveView> {
    // A wrong password is 401 wrong_password, too many tries 429, as on every owner-password route.
    return answer(() => this.udhaar.reversePayment(caller, id, body));
  }

  /** Owner only (`03` #20). */
  @Permission('settings.manage')
  @Post('opening')
  opening(
    @CurrentCaller() caller: Caller,
    @Body(new ZodBodyPipe(udhaarOpeningSchema)) body: UdhaarOpeningInput,
  ): Promise<UdhaarMoveView> {
    return this.udhaar.setOpening(caller, body);
  }
}
