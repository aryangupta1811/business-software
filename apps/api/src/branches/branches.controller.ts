// The owner's routes for branches (P1.6 design, section 7). Everything needs `settings.manage`,
// which only the owner holds, except the picker's short list.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query } from '@nestjs/common';
import {
  branchesQuerySchema,
  branchSchema,
  ownerPasswordSchema,
  type BranchesQuery,
  type BranchInput,
  type BranchRef,
  type BranchView,
  type OwnerPasswordInput,
} from '@business-software/shared';
import { answer } from '../auth/session.controller.js';
import { CurrentCaller, Permission } from '../http/permission.decorator.js';
import type { Caller } from '../http/session.js';
import { UuidPipe } from '../http/uuid.pipe.js';
import { ZodBodyPipe } from '../http/zod-body.pipe.js';
import { BranchesService } from './branches.service.js';

@Controller('branches')
export class BranchesController {
  constructor(@Inject(BranchesService) private readonly branches: BranchesService) {}

  @Permission('settings.manage')
  @Get()
  list(
    @CurrentCaller() caller: Caller,
    @Query(new ZodBodyPipe(branchesQuerySchema)) query: BranchesQuery,
  ): Promise<BranchView[]> {
    return this.branches.list(caller, query.includeArchived);
  }

  /** For the top bar's picker: every active branch for the owner, only their own for staff. */
  @Permission('session.own')
  @Get('picker')
  picker(@CurrentCaller() caller: Caller): Promise<BranchRef[]> {
    return this.branches.picker(caller);
  }

  @Permission('settings.manage')
  @Post()
  create(
    @CurrentCaller() caller: Caller,
    @Body(new ZodBodyPipe(branchSchema)) body: BranchInput,
  ): Promise<BranchView> {
    return this.branches.create(caller, body);
  }

  @Permission('settings.manage')
  @Put(':id')
  update(
    @CurrentCaller() caller: Caller,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodBodyPipe(branchSchema)) body: BranchInput,
  ): Promise<BranchView> {
    return this.branches.update(caller, id, body);
  }

  /** Needs the owner's password. Forgets the branch's computers and ends their sessions. */
  @Permission('settings.manage')
  @Post(':id/archive')
  @HttpCode(200)
  archive(
    @CurrentCaller() caller: Caller,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodBodyPipe(ownerPasswordSchema)) body: OwnerPasswordInput,
  ): Promise<BranchView> {
    return answer(() => this.branches.archive(caller, id, body.ownerPassword));
  }

  @Permission('settings.manage')
  @Post(':id/restore')
  @HttpCode(200)
  restore(@CurrentCaller() caller: Caller, @Param('id', UuidPipe) id: string): Promise<BranchView> {
    return this.branches.restore(caller, id);
  }
}
