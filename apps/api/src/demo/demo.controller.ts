import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  demoLoginSchema,
  type DemoLoginInput,
  type DemoStatus,
  type SessionView,
} from '@business-software/shared';
import type { Database } from '@business-software/db';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { answer } from '../auth/session.controller.js';
import { SESSION_SERVICE, type SessionService } from '../auth/session.service.js';
import { DATABASE } from '../database.module.js';
import { Public } from '../http/permission.decorator.js';
import { ZodBodyPipe } from '../http/zod-body.pipe.js';
import { findDemoBusiness } from './registry.js';

/** Injection token: whether this server is the public demo (`DEMO_ENABLED`). */
export const DEMO_ENABLED = 'DEMO_ENABLED';

/** The demo's two buttons (ADR 0016's 2026-11-24 note). Both are public; both need the flag. */
@Controller('demo')
export class DemoController {
  constructor(
    @Inject(DEMO_ENABLED) private readonly enabled: boolean,
    @Inject(DATABASE) private readonly database: Database,
    @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
  ) {}

  /** Whether the login page shows the buttons: the server is the demo and a demo shop exists. */
  @Public()
  @Get()
  async status(): Promise<DemoStatus> {
    return { enabled: this.enabled && (await findDemoBusiness(this.database)) !== undefined };
  }

  /** "Try as the owner" or "Try as a cashier": a session in the newest demo shop. */
  @Public()
  @Post('login')
  @HttpCode(200)
  login(
    @Body(new ZodBodyPipe(demoLoginSchema)) body: DemoLoginInput,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<SessionView> {
    return answer(async () => {
      if (!this.enabled) throw new NotFoundException({ code: 'demo_unavailable' });
      const result = await this.sessions.loginDemo(body.as, this.sessions.contextOf(request));
      response.setHeader('Set-Cookie', result.setCookies);
      return result.view;
    });
  }
}
