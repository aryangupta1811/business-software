import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import {
  reminderPreparedSchema,
  udhaarCustomersQuerySchema,
  udhaarLedgerQuerySchema,
  udhaarOpeningSchema,
  udhaarPaymentSchema,
  udhaarReversalSchema,
  type ReminderPreparedInput,
  type UdhaarCustomersQuery,
  type UdhaarCustomersView,
  type UdhaarLedgerQuery,
  type UdhaarLedgerView,
  type UdhaarMoveView,
  type UdhaarOpeningInput,
  type UdhaarPaymentInput,
  type UdhaarReversalInput,
  type UdhaarSummaryView,
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

  /** Overdue buckets, collected this week, who owes the most, who to remind (P1.19). */
  @Permission('customers.view')
  @Get('summary')
  summary(@CurrentCaller() caller: Caller): Promise<UdhaarSummaryView> {
    return this.udhaar.summary(caller);
  }

  /** The owner opened WhatsApp with a reminder: logged as prepared, never as delivered (ADR 0049). */
  @Permission('customers.view')
  @Post('reminders/prepared')
  @HttpCode(204)
  async reminderPrepared(
    @CurrentCaller() caller: Caller,
    @Body(new ZodBodyPipe(reminderPreparedSchema)) body: ReminderPreparedInput,
  ): Promise<void> {
    await this.udhaar.reminderPrepared(caller, body);
  }

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
