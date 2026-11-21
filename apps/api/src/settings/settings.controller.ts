import { Body, Controller, Get, Inject, Put } from '@nestjs/common';
import {
  settingsAlertsSchema,
  settingsBusinessSchema,
  settingsFeaturesSchema,
  settingsSecuritySchema,
  settingsStockSchema,
  type SettingsAlertsInput,
  type SettingsBusinessInput,
  type SettingsFeaturesInput,
  type SettingsSecurityInput,
  type SettingsStockInput,
  type SettingsView,
} from '@business-software/shared';
import { CurrentCaller, Permission } from '../http/permission.decorator.js';
import type { Caller } from '../http/session.js';
import { ZodBodyPipe } from '../http/zod-body.pipe.js';
import { SettingsService } from './settings.service.js';

/** Five cards on the settings page, each saved whole (PUT), each answering the full view. */
@Controller('settings')
export class SettingsController {
  constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

  @Permission('settings.view')
  @Get()
  read(@CurrentCaller() caller: Caller): Promise<SettingsView> {
    return this.settings.read(caller);
  }

  @Permission('settings.manage')
  @Put('business')
  saveBusiness(
    @CurrentCaller() caller: Caller,
    @Body(new ZodBodyPipe(settingsBusinessSchema)) body: SettingsBusinessInput,
  ): Promise<SettingsView> {
    return this.settings.saveBusiness(caller, body);
  }

  @Permission('settings.manage')
  @Put('features')
  saveFeatures(
    @CurrentCaller() caller: Caller,
    @Body(new ZodBodyPipe(settingsFeaturesSchema)) body: SettingsFeaturesInput,
  ): Promise<SettingsView> {
    return this.settings.saveFeatures(caller, body);
  }

  @Permission('settings.manage')
  @Put('security')
  saveSecurity(
    @CurrentCaller() caller: Caller,
    @Body(new ZodBodyPipe(settingsSecuritySchema)) body: SettingsSecurityInput,
  ): Promise<SettingsView> {
    return this.settings.saveSecurity(caller, body);
  }

  @Permission('settings.manage')
  @Put('stock')
  saveStock(
    @CurrentCaller() caller: Caller,
    @Body(new ZodBodyPipe(settingsStockSchema)) body: SettingsStockInput,
  ): Promise<SettingsView> {
    return this.settings.saveStock(caller, body);
  }

  @Permission('settings.view')
  @Get('alerts')
  async readAlerts(@CurrentCaller() caller: Caller): Promise<SettingsAlertsInput> {
    return (await this.settings.read(caller)).alerts;
  }

  @Permission('settings.manage')
  @Put('alerts')
  saveAlerts(
    @CurrentCaller() caller: Caller,
    @Body(new ZodBodyPipe(settingsAlertsSchema)) body: SettingsAlertsInput,
  ): Promise<SettingsView> {
    return this.settings.saveAlerts(caller, body);
  }
}
