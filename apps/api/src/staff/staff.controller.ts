// The owner's routes for staff logins (P1.5 design, section 5). Every route needs
// `staff.manage`, which only the owner holds; the owner's password is in the body of exactly the
// ones that give someone more power (question 3A).
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query } from '@nestjs/common';
import {
  newStaffSchema,
  ownerPasswordSchema,
  staffDeactivateSchema,
  staffPasswordSchema,
  staffPermissionsSchema,
  staffQuerySchema,
  staffUpdateSchema,
  type NewStaffInput,
  type OwnerPasswordInput,
  type StaffDeactivateInput,
  type StaffPasswordInput,
  type StaffPermissionsInput,
  type StaffQuery,
  type StaffUpdateInput,
  type StaffView,
} from '@business-software/shared';
import { answer } from '../auth/session.controller.js';
import { CurrentCaller, Permission } from '../http/permission.decorator.js';
import type { Caller } from '../http/session.js';
import { UuidPipe } from '../http/uuid.pipe.js';
import { ZodBodyPipe } from '../http/zod-body.pipe.js';
import { StaffService } from './staff.service.js';

@Controller('staff')
export class StaffController {
  constructor(@Inject(StaffService) private readonly staff: StaffService) {}

  @Permission('staff.manage')
  @Get()
  list(
    @CurrentCaller() caller: Caller,
    @Query(new ZodBodyPipe(staffQuerySchema)) query: StaffQuery,
  ): Promise<StaffView[]> {
    return this.staff.list(caller, query.includeInactive);
  }

  /** Needs the owner's password. */
  @Permission('staff.manage')
  @Post()
  create(
    @CurrentCaller() caller: Caller,
    @Body(new ZodBodyPipe(newStaffSchema)) body: NewStaffInput,
  ): Promise<StaffView> {
    return answer(() => this.staff.create(caller, body));
  }

  @Permission('staff.manage')
  @Put(':id')
  update(
    @CurrentCaller() caller: Caller,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodBodyPipe(staffUpdateSchema)) body: StaffUpdateInput,
  ): Promise<StaffView> {
    return this.staff.update(caller, id, body);
  }

  /** Needs the owner's password (`00` #17). */
  @Permission('staff.manage')
  @Put(':id/permissions')
  setPermissions(
    @CurrentCaller() caller: Caller,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodBodyPipe(staffPermissionsSchema)) body: StaffPermissionsInput,
  ): Promise<StaffView> {
    return answer(() => this.staff.setPermissions(caller, id, body));
  }

  /** Needs the owner's password. Ends every session of that login. */
  @Permission('staff.manage')
  @Post(':id/password')
  @HttpCode(204)
  resetPassword(
    @CurrentCaller() caller: Caller,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodBodyPipe(staffPasswordSchema)) body: StaffPasswordInput,
  ): Promise<void> {
    return answer(() => this.staff.resetPassword(caller, id, body));
  }

  /** No owner's password: it only takes access away. */
  @Permission('staff.manage')
  @Post(':id/deactivate')
  @HttpCode(200)
  deactivate(
    @CurrentCaller() caller: Caller,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodBodyPipe(staffDeactivateSchema)) body: StaffDeactivateInput,
  ): Promise<StaffView> {
    return this.staff.deactivate(caller, id, body);
  }

  /** Needs the owner's password. */
  @Permission('staff.manage')
  @Post(':id/reactivate')
  @HttpCode(200)
  reactivate(
    @CurrentCaller() caller: Caller,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodBodyPipe(ownerPasswordSchema)) body: OwnerPasswordInput,
  ): Promise<StaffView> {
    return answer(() => this.staff.reactivate(caller, id, body.ownerPassword));
  }
}
