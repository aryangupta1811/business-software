// The owner's routes for staff logins (P1.5 design, section 5). Every route needs
// `staff.manage`, which only the owner holds; the owner's password is in the body of exactly the
// ones that give someone more power (question 3A).
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query } from '@nestjs/common';
import {
  newStaffSchema,
  ownerPasswordSchema,
  salaryRateSchema,
  staffAddLoginSchema,
  staffBranchesSchema,
  staffDeactivateSchema,
  staffPasswordSchema,
  staffPermissionsSchema,
  staffQuerySchema,
  staffUpdateSchema,
  type NewStaffInput,
  type OwnerPasswordInput,
  type SalaryRateInput,
  type SalaryRateView,
  type StaffAddLoginInput,
  type StaffBranchesInput,
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

  /** Gives a record without a login its username and password; needs the owner's password. */
  @Permission('staff.manage')
  @Post(':id/login')
  @HttpCode(200)
  addLogin(
    @CurrentCaller() caller: Caller,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodBodyPipe(staffAddLoginSchema)) body: StaffAddLoginInput,
  ): Promise<StaffView> {
    return answer(() => this.staff.addLogin(caller, id, body));
  }

  /** The person's salary history (`05` #3). */
  @Permission('staff.manage')
  @Get(':id/salary-rates')
  salaryRates(
    @CurrentCaller() caller: Caller,
    @Param('id', UuidPipe) id: string,
  ): Promise<SalaryRateView[]> {
    return this.staff.salaryRates(caller, id);
  }

  /** A new rate from the 1st of a month, this month or later (`05` #30). */
  @Permission('staff.manage')
  @Post(':id/salary-rates')
  setSalaryRate(
    @CurrentCaller() caller: Caller,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodBodyPipe(salaryRateSchema)) body: SalaryRateInput,
  ): Promise<SalaryRateView> {
    return this.staff.setSalaryRate(caller, id, body);
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

  /** Needs the owner's password (it gives access). Takes effect at the login's next request. */
  @Permission('staff.manage')
  @Put(':id/branches')
  setBranches(
    @CurrentCaller() caller: Caller,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodBodyPipe(staffBranchesSchema)) body: StaffBranchesInput,
  ): Promise<StaffView> {
    return answer(() => this.staff.setBranches(caller, id, body));
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
