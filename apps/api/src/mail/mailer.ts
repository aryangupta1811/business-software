// How email leaves the API (ADR 0040; P1.4 design, section 9). One interface, three ways out:
// SES on the server (instance-role credentials, no keys anywhere), Mailpit through SMTP on
// this computer, and a fake in tests. Until P2.7's outbox, the API sends right after commit.
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { createTransport } from 'nodemailer';
import type { MailSettings } from '../config.js';
import { describeError } from '../errors.js';

/** Plain text only: no HTML to escape, and every mail client shows it. */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** Injection token for the one Mailer. */
export const MAILER = 'MAILER';

/** A one-line log, given only text the caller chose: never the message itself. */
export type MailLog = (line: string) => void;

/** The part of a nodemailer transport the SMTP mailer uses. */
interface SmtpTransport {
  sendMail(mail: MailMessage & { from: string }): Promise<unknown>;
}

/** Mailpit on this computer (compose.yaml), or any SMTP server. */
export class SmtpMailer implements Mailer {
  constructor(
    private readonly transport: SmtpTransport,
    private readonly from: string,
  ) {}

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...message });
  }
}

/** Amazon SES v2. Credentials come from the default chain: the server's instance role. */
export class SesMailer implements Mailer {
  constructor(
    private readonly client: SESv2Client,
    private readonly from: string,
  ) {}

  async send(message: MailMessage): Promise<void> {
    await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: this.from,
        Destination: { ToAddresses: [message.to] },
        Content: {
          Simple: {
            Subject: { Data: message.subject, Charset: 'UTF-8' },
            Body: { Text: { Data: message.text, Charset: 'UTF-8' } },
          },
        },
      }),
    );
  }
}

/** MAIL_TRANSPORT=none: nothing is sent, and the log says so (without the message). */
export class NoMailer implements Mailer {
  constructor(private readonly log: MailLog = console.warn) {}

  send(message: MailMessage): Promise<void> {
    this.log(`Email is off (MAIL_TRANSPORT=none): "${message.subject}" was not sent`);
    return Promise.resolve();
  }
}

/** Tests read what would have been sent. */
export class FakeMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  private failure: Error | undefined;

  /** Every later send fails with this error, until called with undefined. */
  failWith(error: Error | undefined): void {
    this.failure = error;
  }

  send(message: MailMessage): Promise<void> {
    if (this.failure !== undefined) return Promise.reject(this.failure);
    this.sent.push(message);
    return Promise.resolve();
  }
}

export function createMailer(settings: MailSettings): Mailer {
  switch (settings.transport) {
    case 'none':
      return new NoMailer();
    case 'smtp':
      return new SmtpMailer(createTransport(settings.smtpUrl), settings.from);
    case 'ses':
      return new SesMailer(new SESv2Client({ region: settings.region }), settings.from);
  }
}

/**
 * Best effort, after the transaction has committed (section 9): a failure is logged by its
 * error message and never thrown, so the request still succeeds and the person can press
 * "Send again". The message itself holds a one-time link, so it is never logged.
 */
export async function sendAfterCommit(
  mailer: Mailer,
  log: MailLog,
  what: string,
  message: MailMessage,
): Promise<void> {
  try {
    await mailer.send(message);
  } catch (error) {
    log(`Could not send the ${what} email: ${describeError(error)}`);
  }
}
