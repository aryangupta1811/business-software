// Remembered computers on the Settings page (Module 00 #44).
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import {
  deviceBranchSchema,
  deviceNameSchema,
  ownerPasswordSchema,
  type DeviceBranchInput,
  type DeviceNameInput,
  type DeviceView,
  type OwnerPasswordInput,
} from '@business-software/shared';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { answer } from '../auth/session.controller.js';
import { SESSION_SERVICE, type SessionService } from '../auth/session.service.js';
import { CurrentCaller, Permission } from '../http/permission.decorator.js';
import type { Caller } from '../http/session.js';
import { UuidPipe } from '../http/uuid.pipe.js';
import { ZodBodyPipe } from '../http/zod-body.pipe.js';
import { DevicesService } from './devices.service.js';

@Controller('devices')
export class DevicesController {
  constructor(
    @Inject(DevicesService) private readonly devices: DevicesService,
    @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
  ) {}

  @Permission('settings.view')
  @Get()
  list(@CurrentCaller() caller: Caller, @Req() request: IncomingMessage): Promise<DeviceView[]> {
    return this.devices.list(caller, this.sessions.contextOf(request));
  }

  @Permission('settings.manage')
  @Put(':id/name')
  rename(
    @CurrentCaller() caller: Caller,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodBodyPipe(deviceNameSchema)) body: DeviceNameInput,
    @Req() request: IncomingMessage,
  ): Promise<DeviceView> {
    return this.devices.rename(caller, id, body.name, this.sessions.contextOf(request));
  }

  /**
   * Needs the owner's password. Ends the sessions on that computer, yours too when it is this
   * one (P1.6).
   */
  @Permission('settings.manage')
  @Put(':id/branch')
  async move(
    @CurrentCaller() caller: Caller,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodBodyPipe(deviceBranchSchema)) body: DeviceBranchInput,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<DeviceView> {
    const { device, endedOwnSession } = await answer(() =>
      this.devices.move(
        caller,
        id,
        body.branchId,
        body.ownerPassword,
        this.sessions.contextOf(request),
      ),
    );
    if (endedOwnSession) response.setHeader('Set-Cookie', [this.sessions.clearSessionCookie()]);
    return device;
  }

  /** Needs the owner's password. Forgetting this computer logs you out here. */
  @Permission('settings.manage')
  @Post(':id/forget')
  @HttpCode(204)
  async forget(
    @CurrentCaller() caller: Caller,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodBodyPipe(ownerPasswordSchema)) body: OwnerPasswordInput,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<void> {
    const { thisComputer } = await answer(() =>
      this.devices.forget(caller, id, body.ownerPassword, this.sessions.contextOf(request)),
    );
    if (thisComputer) {
      response.setHeader('Set-Cookie', [
        this.sessions.clearSessionCookie(),
        this.sessions.clearDeviceCookie(),
      ]);
    }
  }
}
