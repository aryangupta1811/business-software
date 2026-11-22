import { Body, Controller, Inject, Post } from '@nestjs/common';
import { billDraftSchema, type BillDraft, type SavedBillView } from '@business-software/shared';
import { CurrentCaller, Permission } from '../http/permission.decorator.js';
import type { Caller } from '../http/session.js';
import { ZodBodyPipe } from '../http/zod-body.pipe.js';
import { BillsService } from './bills.service.js';

/** Saved bills (P1.14). Printing reads them in P1.15. */
@Controller('bills')
export class BillsController {
  constructor(@Inject(BillsService) private readonly bills: BillsService) {}

  /**
   * Saves a paid bill. A retry with the same bill key and the same request gets the saved bill
   * back (`201` again, as a stock retry does), so a lost answer never makes a second bill.
   */
  @Permission('billing.sell')
  @Post()
  save(
    @CurrentCaller() caller: Caller,
    @Body(new ZodBodyPipe(billDraftSchema)) body: BillDraft,
  ): Promise<SavedBillView> {
    return this.bills.save(caller, body);
  }
}
