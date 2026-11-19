import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  barcode,
  barcodeSchema,
  categorySchema,
  itemQuerySchema,
  itemUpdateSchema,
  newItemSchema,
  unitSchema,
  type BarcodeInput,
  type BarcodeMatch,
  type CategoryInput,
  type CategoryView,
  type ItemPage,
  type ItemsContext,
  type ItemQuery,
  type ItemUpdateInput,
  type ItemView,
  type NewItemInput,
  type UnitInput,
  type UnitView,
} from '@business-software/shared';
import { CurrentCaller, Permission } from '../http/permission.decorator.js';
import type { Caller } from '../http/session.js';
import { UuidPipe } from '../http/uuid.pipe.js';
import { ZodBodyPipe } from '../http/zod-body.pipe.js';
import { CatalogueService } from './catalogue.service.js';
import { ItemsService } from './items.service.js';

/** Items (P1.7, design §6). Reading needs `items.view`; any change needs `items.manage`. */
@Controller('items')
export class ItemsController {
  constructor(@Inject(ItemsService) private readonly items: ItemsService) {}

  @Permission('items.view')
  @Get()
  list(
    @CurrentCaller() caller: Caller,
    @Query(new ZodBodyPipe(itemQuerySchema)) query: ItemQuery,
  ): Promise<ItemPage> {
    return this.items.list(caller, query);
  }

  // Before `:id`, so "context" isn't read as an item's id.
  @Permission('items.view')
  @Get('context')
  context(@CurrentCaller() caller: Caller): Promise<ItemsContext> {
    return this.items.context(caller);
  }

  @Permission('items.view')
  @Get('barcode/:code')
  byBarcode(@CurrentCaller() caller: Caller, @Param('code') code: string): Promise<BarcodeMatch> {
    // Anything that can't be a barcode is no barcode we know (the same check as saving one).
    const scanned = barcode().safeParse(code);
    if (!scanned.success) throw new NotFoundException({ code: 'unknown_barcode' });
    return this.items.byBarcode(caller, scanned.data);
  }

  @Permission('items.view')
  @Get(':id')
  read(@CurrentCaller() caller: Caller, @Param('id', UuidPipe) id: string): Promise<ItemView> {
    return this.items.read(caller, id);
  }

  @Permission('items.manage')
  @Post()
  create(
    @CurrentCaller() caller: Caller,
    @Body(new ZodBodyPipe(newItemSchema)) body: NewItemInput,
  ): Promise<ItemView> {
    return this.items.create(caller, body);
  }

  @Permission('items.manage')
  @Put(':id')
  update(
    @CurrentCaller() caller: Caller,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodBodyPipe(itemUpdateSchema)) body: ItemUpdateInput,
  ): Promise<ItemView> {
    return this.items.update(caller, id, body);
  }

  @Permission('items.manage')
  @Post(':id/archive')
  @HttpCode(200)
  archive(@CurrentCaller() caller: Caller, @Param('id', UuidPipe) id: string): Promise<ItemView> {
    return this.items.archive(caller, id);
  }

  @Permission('items.manage')
  @Post(':id/restore')
  @HttpCode(200)
  restore(@CurrentCaller() caller: Caller, @Param('id', UuidPipe) id: string): Promise<ItemView> {
    return this.items.restore(caller, id);
  }

  @Permission('items.manage')
  @Post(':id/barcodes')
  addBarcode(
    @CurrentCaller() caller: Caller,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodBodyPipe(barcodeSchema)) body: BarcodeInput,
  ): Promise<ItemView> {
    return this.items.addBarcode(caller, id, body);
  }

  @Permission('items.manage')
  @Post(':id/barcodes/:barcodeId/remove')
  @HttpCode(200)
  removeBarcode(
    @CurrentCaller() caller: Caller,
    @Param('id', UuidPipe) id: string,
    @Param('barcodeId', UuidPipe) barcodeId: string,
  ): Promise<ItemView> {
    return this.items.removeBarcode(caller, id, barcodeId);
  }
}

/** The owner's categories (Module 00 #4). */
@Controller('categories')
export class CategoriesController {
  constructor(@Inject(CatalogueService) private readonly catalogue: CatalogueService) {}

  @Permission('items.view')
  @Get()
  list(@CurrentCaller() caller: Caller): Promise<CategoryView[]> {
    return this.catalogue.listCategories(caller);
  }

  @Permission('items.manage')
  @Post()
  create(
    @CurrentCaller() caller: Caller,
    @Body(new ZodBodyPipe(categorySchema)) body: CategoryInput,
  ): Promise<CategoryView> {
    return this.catalogue.createCategory(caller, body);
  }

  @Permission('items.manage')
  @Put(':id')
  update(
    @CurrentCaller() caller: Caller,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodBodyPipe(categorySchema)) body: CategoryInput,
  ): Promise<CategoryView> {
    return this.catalogue.updateCategory(caller, id, body);
  }

  @Permission('items.manage')
  @Post(':id/archive')
  @HttpCode(200)
  archive(
    @CurrentCaller() caller: Caller,
    @Param('id', UuidPipe) id: string,
  ): Promise<CategoryView> {
    return this.catalogue.setCategoryArchived(caller, id, true);
  }

  @Permission('items.manage')
  @Post(':id/restore')
  @HttpCode(200)
  restore(
    @CurrentCaller() caller: Caller,
    @Param('id', UuidPipe) id: string,
  ): Promise<CategoryView> {
    return this.catalogue.setCategoryArchived(caller, id, false);
  }
}

/** The owner's own units (Module 01 #16). */
@Controller('units')
export class UnitsController {
  constructor(@Inject(CatalogueService) private readonly catalogue: CatalogueService) {}

  @Permission('items.view')
  @Get()
  list(@CurrentCaller() caller: Caller): Promise<UnitView[]> {
    return this.catalogue.listUnits(caller);
  }

  @Permission('items.manage')
  @Post()
  create(
    @CurrentCaller() caller: Caller,
    @Body(new ZodBodyPipe(unitSchema)) body: UnitInput,
  ): Promise<UnitView> {
    return this.catalogue.createUnit(caller, body);
  }

  @Permission('items.manage')
  @Put(':id')
  update(
    @CurrentCaller() caller: Caller,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodBodyPipe(unitSchema)) body: UnitInput,
  ): Promise<UnitView> {
    return this.catalogue.updateUnit(caller, id, body);
  }

  @Permission('items.manage')
  @Post(':id/archive')
  @HttpCode(200)
  archive(@CurrentCaller() caller: Caller, @Param('id', UuidPipe) id: string): Promise<UnitView> {
    return this.catalogue.setUnitArchived(caller, id, true);
  }

  @Permission('items.manage')
  @Post(':id/restore')
  @HttpCode(200)
  restore(@CurrentCaller() caller: Caller, @Param('id', UuidPipe) id: string): Promise<UnitView> {
    return this.catalogue.setUnitArchived(caller, id, false);
  }
}
