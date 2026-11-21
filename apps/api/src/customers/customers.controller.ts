import { Body, Controller, Get, Inject, Param, Post, Put, Query } from '@nestjs/common';
import {
  customerQuerySchema,
  customerSchema,
  customerUpdateSchema,
  type CustomerInput,
  type CustomerQuery,
  type CustomerUpdateInput,
  type CustomerView,
} from '@business-software/shared';
import { CurrentCaller, Permission } from '../http/permission.decorator.js';
import type { Caller } from '../http/session.js';
import { UuidPipe } from '../http/uuid.pipe.js';
import { ZodBodyPipe } from '../http/zod-body.pipe.js';
import { CustomersService } from './customers.service.js';

/** Customers (P1.13 design §7, §14): finding needs `customers.view`, changes `customers.manage`. */
@Controller('customers')
export class CustomersController {
  constructor(@Inject(CustomersService) private readonly customers: CustomersService) {}

  @Permission('customers.view')
  @Get()
  find(
    @CurrentCaller() caller: Caller,
    @Query(new ZodBodyPipe(customerQuerySchema)) query: CustomerQuery,
  ): Promise<CustomerView[]> {
    return this.customers.find(caller, query);
  }

  @Permission('customers.manage')
  @Post()
  create(
    @CurrentCaller() caller: Caller,
    @Body(new ZodBodyPipe(customerSchema)) body: CustomerInput,
  ): Promise<CustomerView> {
    return this.customers.create(caller, body);
  }

  @Permission('customers.manage')
  @Put(':id')
  update(
    @CurrentCaller() caller: Caller,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodBodyPipe(customerUpdateSchema)) body: CustomerUpdateInput,
  ): Promise<CustomerView> {
    return this.customers.update(caller, id, body);
  }
}
