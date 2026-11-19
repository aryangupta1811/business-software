// Login, session, lock and logout routes (Module 00 #21, #27, #28, #38; P1.4 design, section 5).
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ownerLoginSchema,
  staffLoginSchema,
  unlockSchema,
  type OwnerLoginInput,
  type SessionView,
  type StaffLoginInput,
  type UnlockInput,
} from '@business-software/shared';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AllowLocked, CurrentCaller, Permission, Public } from '../http/permission.decorator.js';
import type { Caller, ResolveOptions, SessionResolver } from '../http/session.js';
import { ZodBodyPipe } from '../http/zod-body.pipe.js';
import { BusyError } from './hash-gate.js';
import {
  NoDeviceError,
  SESSION_SERVICE,
  SessionEndedError,
  SessionService,
  TooManyAttemptsError,
  WrongLoginError,
} from './session.service.js';

/** Maps the session service's errors to HTTP answers with codes (ADR 0036). */
export function toHttpError(error: unknown): unknown {
  if (error instanceof WrongLoginError) return new UnauthorizedException({ code: 'wrong_login' });
  if (error instanceof NoDeviceError) return new UnauthorizedException({ code: 'no_device' });
  if (error instanceof SessionEndedError) {
    return new UnauthorizedException({ code: 'session_ended' });
  }
  if (error instanceof TooManyAttemptsError) {
    return new HttpException(
      { code: 'too_many_attempts', retryAt: error.retryAt.toISOString() },
      429,
    );
  }
  if (error instanceof BusyError) return new ServiceUnavailableException({ code: 'busy' });
  return error;
}

async function answer<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw toHttpError(error);
  }
}

/** The real resolver: the session cookie, looked up in PostgreSQL (ADR 0009). */
export class CookieSessionResolver implements SessionResolver {
  constructor(private readonly sessions: SessionService) {}

  resolve(request: IncomingMessage, options: ResolveOptions): Promise<Caller | null> {
    return answer(() => this.sessions.resolve(request, options.passive));
  }
}

@Controller()
export class SessionController {
  constructor(@Inject(SESSION_SERVICE) private readonly sessions: SessionService) {}

  /** #27: the owner logs in with email and password. */
  @Public()
  @Post('login')
  @HttpCode(200)
  login(
    @Body(new ZodBodyPipe(ownerLoginSchema)) body: OwnerLoginInput,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<SessionView> {
    return answer(async () => {
      const context = this.sessions.contextOf(request);
      const result = await this.sessions.loginOwner(body.email, body.password, context);
      response.setHeader('Set-Cookie', result.setCookies);
      return result.view;
    });
  }

  /** #28: staff log in on a computer the owner has logged in on. */
  @Public()
  @Post('login/staff')
  @HttpCode(200)
  loginStaff(
    @Body(new ZodBodyPipe(staffLoginSchema)) body: StaffLoginInput,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<SessionView> {
    return answer(async () => {
      const context = this.sessions.contextOf(request);
      const result = await this.sessions.loginStaff(body.username, body.password, context);
      response.setHeader('Set-Cookie', result.setCookies);
      return result.view;
    });
  }

  /**
   * Who is logged in here, with the CSRF token; or, with no session, which business this
   * computer remembers. Public and passive: reading it doesn't keep a session awake.
   */
  @Public()
  @Get('session')
  session(@Req() request: IncomingMessage): Promise<SessionView> {
    return answer(() => this.sessions.view(request));
  }

  /** #38: the owner's "Lock now". Staff sessions don't lock (#29). */
  @Permission('session.own')
  @Post('session/lock')
  @HttpCode(204)
  async lock(@CurrentCaller() caller: Caller): Promise<void> {
    if (caller.role !== 'owner') throw new ForbiddenException({ code: 'forbidden' });
    await this.sessions.lock(caller);
  }

  /** #21: unlocking needs the password. */
  @Permission('session.own')
  @AllowLocked()
  @Post('session/unlock')
  @HttpCode(204)
  unlock(
    @CurrentCaller() caller: Caller,
    @Body(new ZodBodyPipe(unlockSchema)) body: UnlockInput,
  ): Promise<void> {
    return answer(async () => {
      if (!(await this.sessions.unlock(caller, body.password))) {
        throw new UnauthorizedException({ code: 'wrong_password' });
      }
    });
  }

  @Permission('session.own')
  @AllowLocked()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @CurrentCaller() caller: Caller,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<void> {
    response.setHeader('Set-Cookie', await this.sessions.logout(caller));
  }
}
