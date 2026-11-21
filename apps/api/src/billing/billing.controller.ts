import { Controller, Get, Inject, Query } from '@nestjs/common';
import {
  catalogueQuerySchema,
  type CatalogueQuery,
  type CatalogueView,
} from '@business-software/shared';
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
}
