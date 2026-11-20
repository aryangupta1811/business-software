// Email confirmation, password reset, recovery key and your own password (Module 00 #30-#32,
// #46; P1.4 design, section 10). The public routes still need a same-origin request (ADR 0038).
import { Body, Controller, ForbiddenException, HttpCode, Inject, Post, Req } from '@nestjs/common';
import {
  changePasswordSchema,
  confirmEmailSchema,
  ownerPasswordSchema,
  recoveryResetSchema,
  resetCompleteSchema,
  resetRequestSchema,
  type ChangePasswordInput,
  type ConfirmEmailInput,
  type OwnerPasswordInput,
  type RecoveryKeyResult,
  type RecoveryResetInput,
  type ResetCompleteInput,
  type ResetRequestInput,
} from '@business-software/shared';
import type { IncomingMessage } from 'node:http';
import { answer } from '../auth/session.controller.js';
import { SESSION_SERVICE, type SessionService } from '../auth/session.service.js';
import { CurrentCaller, Permission, Public } from '../http/permission.decorator.js';
import type { Caller } from '../http/session.js';
import { ZodBodyPipe } from '../http/zod-body.pipe.js';
import { AccountService } from './account.service.js';

function ownerOnly(caller: Caller): void {
  if (caller.role !== 'owner') throw new ForbiddenException({ code: 'forbidden' });
}

@Controller()
export class AccountController {
  constructor(
    @Inject(AccountService) private readonly accounts: AccountService,
    @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
  ) {}

  /** #32's "Send again" on the banner. */
  @Permission('session.own')
  @Post('email/confirm/send')
  @HttpCode(204)
  sendConfirmation(@CurrentCaller() caller: Caller): Promise<void> {
    ownerOnly(caller);
    return answer(() => this.accounts.sendConfirmation(caller));
  }

  /** #32: the confirmation page POSTs the link's business and token. */
  @Public()
  @Post('email/confirm')
  @HttpCode(204)
  confirmEmail(
    @Body(new ZodBodyPipe(confirmEmailSchema)) body: ConfirmEmailInput,
    @Req() request: IncomingMessage,
  ): Promise<void> {
    return answer(() =>
      this.accounts.confirmEmail(body.businessId, body.token, this.sessions.contextOf(request)),
    );
  }

  /** #30: always 202, whether or not the email has an account. */
  @Public()
  @Post('password-reset/request')
  @HttpCode(202)
  requestReset(
    @Body(new ZodBodyPipe(resetRequestSchema)) body: ResetRequestInput,
    @Req() request: IncomingMessage,
  ): Promise<void> {
    return answer(() => this.accounts.requestReset(body.email, this.sessions.contextOf(request)));
  }

  @Public()
  @Post('password-reset/complete')
  @HttpCode(204)
  completeReset(
    @Body(new ZodBodyPipe(resetCompleteSchema)) body: ResetCompleteInput,
    @Req() request: IncomingMessage,
  ): Promise<void> {
    return answer(() =>
      this.accounts.completeReset(
        body.businessId,
        body.token,
        body.newPassword,
        this.sessions.contextOf(request),
      ),
    );
  }

  /** #31: answers the next recovery key, once. */
  @Public()
  @Post('recovery/reset')
  @HttpCode(200)
  async recoveryReset(
    @Body(new ZodBodyPipe(recoveryResetSchema)) body: RecoveryResetInput,
    @Req() request: IncomingMessage,
  ): Promise<RecoveryKeyResult> {
    const recoveryKey = await answer(() =>
      this.accounts.resetWithRecoveryKey(
        body.email,
        body.recoveryKey,
        body.newPassword,
        this.sessions.contextOf(request),
      ),
    );
    return { recoveryKey };
  }

  /** "Make a new recovery key": the old one stops working (covers P1.3's lost answer). */
  @Permission('settings.manage')
  @Post('recovery-key')
  @HttpCode(200)
  async newRecoveryKey(
    @CurrentCaller() caller: Caller,
    @Body(new ZodBodyPipe(ownerPasswordSchema)) body: OwnerPasswordInput,
  ): Promise<RecoveryKeyResult> {
    ownerOnly(caller);
    const recoveryKey = await answer(() =>
      this.accounts.newRecoveryKey(caller, body.ownerPassword),
    );
    return { recoveryKey };
  }

  /** #46: anyone logged in changes their own password. */
  @Permission('session.own')
  @Post('password')
  @HttpCode(204)
  changePassword(
    @CurrentCaller() caller: Caller,
    @Body(new ZodBodyPipe(changePasswordSchema)) body: ChangePasswordInput,
  ): Promise<void> {
    return answer(() =>
      this.accounts.changePassword(caller, body.currentPassword, body.newPassword),
    );
  }
}
