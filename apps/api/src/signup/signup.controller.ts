import {
  Body,
  ConflictException,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { signupSchema, type SignupInput, type SignupResult } from '@business-software/shared';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { toHttpError } from '../auth/session.controller.js';
import {
  SESSION_SERVICE,
  TooManyAttemptsError,
  type SessionService,
} from '../auth/session.service.js';
import { Public } from '../http/permission.decorator.js';
import { ZodBodyPipe } from '../http/zod-body.pipe.js';
import { EmailTakenError, SignupService } from './signup.service.js';

@Controller('signup')
export class SignupController {
  constructor(
    @Inject(SignupService) private readonly signups: SignupService,
    @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
  ) {}

  /**
   * Module 00 #7, #37. Telling a visitor that an email has an account follows from #27, so
   * signup is rate-limited per computer (P1.4 design, section 7).
   */
  @Public()
  @Post()
  @HttpCode(201)
  async signUp(
    @Body(new ZodBodyPipe(signupSchema)) body: SignupInput,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<SignupResult> {
    try {
      const context = this.sessions.contextOf(request);
      const verdict = this.sessions.limits.signup.hit(context.ip);
      if (!verdict.allowed) throw new TooManyAttemptsError(verdict.retryAt);
      const { setCookies, ...result } = await this.signups.signUp(body, context);
      response.setHeader('Set-Cookie', setCookies);
      return result;
    } catch (error) {
      if (error instanceof EmailTakenError) throw new ConflictException({ code: 'email_taken' });
      throw toHttpError(error);
    }
  }
}
