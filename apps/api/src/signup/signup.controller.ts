import { Body, ConflictException, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { signupSchema, type SignupInput, type SignupResult } from '@business-software/shared';
import { Public } from '../http/permission.decorator.js';
import { ZodBodyPipe } from '../http/zod-body.pipe.js';
import { EmailTakenError, SignupService } from './signup.service.js';

@Controller('signup')
export class SignupController {
  constructor(@Inject(SignupService) private readonly signups: SignupService) {}

  /**
   * Module 00 #7. Telling a visitor that an email has an account follows from #27; P1.4's
   * rate limit covers this route before it is ever deployed.
   */
  @Public()
  @Post()
  @HttpCode(201)
  async signUp(@Body(new ZodBodyPipe(signupSchema)) body: SignupInput): Promise<SignupResult> {
    try {
      return await this.signups.signUp(body);
    } catch (error) {
      if (error instanceof EmailTakenError) throw new ConflictException({ code: 'email_taken' });
      throw error;
    }
  }
}
