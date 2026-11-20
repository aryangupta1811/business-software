import { Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import {
  adjustmentSchema,
  movementQuerySchema,
  openingStockSchema,
  type AdjustmentInput,
  type ItemStockView,
  type MovementPage,
  type MovementQuery,
  type MovementView,
  type OpeningStockInput,
} from '@business-software/shared';
import { CurrentCaller, Permission } from '../http/permission.decorator.js';
import type { Caller } from '../http/session.js';
import { UuidPipe } from '../http/uuid.pipe.js';
import { ZodBodyPipe } from '../http/zod-body.pipe.js';
import { StockService } from './stock.service.js';

/** An item's stock (P1.8, design §8). Reading needs `stock.view`; changes need `stock.adjust`. */
@Controller('items/:id/stock')
export class StockController {
  constructor(@Inject(StockService) private readonly stock: StockService) {}

  @Permission('stock.view')
  @Get()
  view(@CurrentCaller() caller: Caller, @Param('id', UuidPipe) id: string): Promise<ItemStockView> {
    return this.stock.view(caller, id);
  }

  @Permission('stock.view')
  @Get('movements')
  movements(
    @CurrentCaller() caller: Caller,
    @Param('id', UuidPipe) id: string,
    @Query(new ZodBodyPipe(movementQuerySchema)) query: MovementQuery,
  ): Promise<MovementPage> {
    return this.stock.movements(caller, id, query);
  }

  @Permission('stock.adjust')
  @Post('opening')
  open(
    @CurrentCaller() caller: Caller,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodBodyPipe(openingStockSchema)) body: OpeningStockInput,
  ): Promise<MovementView> {
    return this.stock.open(caller, id, body);
  }

  @Permission('stock.adjust')
  @Post('adjustments')
  adjust(
    @CurrentCaller() caller: Caller,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodBodyPipe(adjustmentSchema)) body: AdjustmentInput,
  ): Promise<MovementView> {
    return this.stock.adjust(caller, id, body);
  }
}
