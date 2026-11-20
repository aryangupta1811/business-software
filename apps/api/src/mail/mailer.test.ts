import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { describe, expect, it, vi } from 'vitest';
import {
  createMailer,
  FakeMailer,
  NoMailer,
  SesMailer,
  SmtpMailer,
  sendAfterCommit,
} from './mailer.js';
import { confirmEmailMessage, resetPasswordMessage } from './messages.js';

const message = { to: 'owner@example.test', subject: 'Hello', text: 'Body' };

describe('mailers (ADR 0040)', () => {
  it('picks the mailer the settings name', () => {
    expect(createMailer({ transport: 'none' })).toBeInstanceOf(NoMailer);
    expect(
      createMailer({ transport: 'smtp', smtpUrl: 'smtp://127.0.0.1:1025', from: 'a@example.test' }),
    ).toBeInstanceOf(SmtpMailer);
    expect(
      createMailer({ transport: 'ses', region: 'ap-south-1', from: 'a@example.test' }),
    ).toBeInstanceOf(SesMailer);
  });

  it('sends through SMTP from the configured sender', async () => {
    const sendMail = vi.fn().mockResolvedValue({});
    await new SmtpMailer({ sendMail }, 'shop-app@example.test').send(message);
    expect(sendMail).toHaveBeenCalledWith({ from: 'shop-app@example.test', ...message });
  });

  it('sends through SES v2 as plain UTF-8 text', async () => {
    const client = new SESv2Client({ region: 'ap-south-1' });
    const send = vi.spyOn(client, 'send').mockResolvedValue({} as never);
    await new SesMailer(client, 'shop-app@example.test').send(message);
    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(SendEmailCommand);
    expect((command as SendEmailCommand).input).toEqual({
      FromEmailAddress: 'shop-app@example.test',
      Destination: { ToAddresses: ['owner@example.test'] },
      Content: {
        Simple: {
          Subject: { Data: 'Hello', Charset: 'UTF-8' },
          Body: { Text: { Data: 'Body', Charset: 'UTF-8' } },
        },
      },
    });
  });

  it('with no transport, logs that nothing was sent, without the message', async () => {
    const log = vi.fn();
    await new NoMailer(log).send({ ...message, text: 'secret link' });
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret link');
  });

  // Best effort after commit (section 9): a failure is logged, never thrown, never the link.
  it('logs a failed send by its message only, never the email', async () => {
    const mailer = new FakeMailer();
    mailer.failWith(new Error('SMTP refused'));
    const log = vi.fn();
    await sendAfterCommit(mailer, log, 'password reset', { ...message, text: 'secret link' });
    expect(log).toHaveBeenCalledWith('Could not send the password reset email: SMTP refused');
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret link');
  });
});

describe('email messages', () => {
  const link = 'http://127.0.0.1:5173/reset/b/t';

  // The server doesn't know the reader's language, so each email has English and Hindi.
  it.each([
    ['confirm', confirmEmailMessage('owner@example.test', link)],
    ['reset', resetPasswordMessage('owner@example.test', link)],
  ])('the %s email holds the link once per language, in English and Hindi', (_kind, mail) => {
    expect(mail.to).toBe('owner@example.test');
    expect(mail.text.split(link)).toHaveLength(3);
    expect(mail.subject).toMatch(/[A-Za-z]/);
    expect(mail.subject).toMatch(/[ऀ-ॿ]/);
    expect(mail.text).toMatch(/[ऀ-ॿ]/);
  });

  it('says how long each link works (Module 00 #42)', () => {
    expect(resetPasswordMessage('a@example.test', link).text).toContain('30 minutes');
    expect(confirmEmailMessage('a@example.test', link).text).toContain('7 days');
  });
});
