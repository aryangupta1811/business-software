import { describe, expect, it } from 'vitest';
import { loadConfig, loadWorkerConfig } from './config.js';

const DATABASE_URL = 'postgresql://app_runtime:pw@127.0.0.1:5432/business_software';

describe('loadConfig', () => {
  it('reads the database URL and defaults the rest', () => {
    expect(loadConfig({ DATABASE_URL })).toEqual({
      databaseUrl: DATABASE_URL,
      host: '127.0.0.1',
      port: 3000,
      jsonLogs: false,
      cookieSecure: true,
      mail: { transport: 'none' },
      appUrl: 'http://127.0.0.1:5173',
      emailLimited: false,
      demoEnabled: false,
    });
  });

  // Only this computer by default; containers set HOST=0.0.0.0 (compose.yaml).
  it('reads HOST and PORT, and logs JSON in production', () => {
    expect(
      loadConfig({ DATABASE_URL, HOST: '0.0.0.0', PORT: '8080', NODE_ENV: 'production' }),
    ).toEqual({
      databaseUrl: DATABASE_URL,
      host: '0.0.0.0',
      port: 8080,
      jsonLogs: true,
      cookieSecure: true,
      mail: { transport: 'none' },
      appUrl: 'http://127.0.0.1:5173',
      emailLimited: false,
      demoEnabled: false,
    });
  });

  // ADR 0016's 2026-11-24 note: only the public demo server turns the demo on.
  it('reads DEMO_ENABLED, off unless set, and refuses anything but true or false', () => {
    expect(loadConfig({ DATABASE_URL }).demoEnabled).toBe(false);
    expect(loadConfig({ DATABASE_URL, DEMO_ENABLED: 'true' }).demoEnabled).toBe(true);
    expect(() => loadConfig({ DATABASE_URL, DEMO_ENABLED: 'yes' })).toThrow(
      'DEMO_ENABLED must be true or false',
    );
  });

  // Plain-HTTP local development only (ADR 0009 note).
  it('reads COOKIE_SECURE and refuses anything but true or false', () => {
    expect(loadConfig({ DATABASE_URL, COOKIE_SECURE: 'false' }).cookieSecure).toBe(false);
    expect(() => loadConfig({ DATABASE_URL, COOKIE_SECURE: 'no' })).toThrow(
      'COOKIE_SECURE must be true or false',
    );
  });

  it('refuses to start without DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow('DATABASE_URL is not set');
  });

  // The URL holds the database password, and startup errors end up in logs.
  it('names a malformed DATABASE_URL without showing its password', () => {
    let message = '';
    try {
      loadConfig({ DATABASE_URL: 'mysql://u:s3cretpw@h/d' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe('DATABASE_URL is not a postgresql:// URL');
    expect(message).not.toContain('s3cretpw');
  });

  it('refuses a DATABASE_URL that is not a URL at all, without echoing it', () => {
    expect(() => loadConfig({ DATABASE_URL: 's3cretpw' })).toThrow(
      /^DATABASE_URL is not a postgresql:\/\/ URL$/,
    );
  });

  it('refuses an empty HOST', () => {
    expect(() => loadConfig({ DATABASE_URL, HOST: '' })).toThrow('HOST must not be empty');
  });

  it.each(['0', '70000', 'abc', '3000.5', ''])('refuses PORT=%j', (PORT) => {
    expect(() => loadConfig({ DATABASE_URL, PORT })).toThrow(
      'PORT must be a whole number from 1 to 65535',
    );
  });

  // ADR 0040: Mailpit through SMTP on this computer, SES on the server.
  describe('email', () => {
    const MAIL_FROM = 'shop-app@example.test';

    it('sends to Mailpit through SMTP', () => {
      const config = loadConfig({
        DATABASE_URL,
        MAIL_TRANSPORT: 'smtp',
        SMTP_URL: 'smtp://127.0.0.1:1025',
        MAIL_FROM,
        APP_URL: 'http://127.0.0.1:8080/',
      });
      expect(config.mail).toEqual({
        transport: 'smtp',
        smtpUrl: 'smtp://127.0.0.1:1025',
        from: MAIL_FROM,
      });
      // No trailing slash, so links join cleanly.
      expect(config.appUrl).toBe('http://127.0.0.1:8080');
    });

    it('sends through SES in Mumbai unless AWS_REGION says otherwise', () => {
      expect(loadConfig({ DATABASE_URL, MAIL_TRANSPORT: 'ses', MAIL_FROM }).mail).toEqual({
        transport: 'ses',
        region: 'ap-south-1',
        from: MAIL_FROM,
      });
      expect(
        loadConfig({ DATABASE_URL, MAIL_TRANSPORT: 'ses', MAIL_FROM, AWS_REGION: 'us-east-1' })
          .mail,
      ).toEqual({ transport: 'ses', region: 'us-east-1', from: MAIL_FROM });
    });

    it('reads EMAIL_LIMITED for the demo (Module 00 #45)', () => {
      expect(loadConfig({ DATABASE_URL, EMAIL_LIMITED: 'true' }).emailLimited).toBe(true);
      expect(() => loadConfig({ DATABASE_URL, EMAIL_LIMITED: 'yes' })).toThrow(
        'EMAIL_LIMITED must be true or false',
      );
    });

    it.each([
      [{ MAIL_TRANSPORT: 'post' }, 'MAIL_TRANSPORT must be none, smtp or ses'],
      [{ MAIL_TRANSPORT: 'ses' }, 'MAIL_FROM is not set'],
      [{ MAIL_TRANSPORT: 'ses', MAIL_FROM: 'not an email' }, 'MAIL_FROM is not an email address'],
      [{ MAIL_TRANSPORT: 'smtp', MAIL_FROM }, 'SMTP_URL is not set'],
      [
        { MAIL_TRANSPORT: 'smtp', MAIL_FROM, SMTP_URL: 'http://x' },
        'SMTP_URL is not an smtp:// URL',
      ],
      [{ APP_URL: 'ftp://shop' }, 'APP_URL is not an http(s) URL'],
    ])('refuses %j', (env, message) => {
      expect(() => loadConfig({ DATABASE_URL, ...env })).toThrow(message);
    });

    // The SMTP URL may hold a password one day; errors name the variable only.
    it('never shows SMTP_URL in its error', () => {
      expect(() =>
        loadConfig({ DATABASE_URL, MAIL_TRANSPORT: 'smtp', MAIL_FROM, SMTP_URL: 's3cretpw' }),
      ).toThrow(/^SMTP_URL is not an smtp:\/\/ URL$/);
    });
  });
});

describe('loadWorkerConfig', () => {
  const QUEUE_DATABASE_URL = 'postgresql://app_queue:pw@127.0.0.1:5432/business_software';

  it('adds the queue database URL to everything the api reads', () => {
    expect(loadWorkerConfig({ DATABASE_URL, QUEUE_DATABASE_URL })).toEqual({
      ...loadConfig({ DATABASE_URL }),
      queueDatabaseUrl: QUEUE_DATABASE_URL,
    });
  });

  it('refuses to start without QUEUE_DATABASE_URL', () => {
    expect(() => loadWorkerConfig({ DATABASE_URL })).toThrow('QUEUE_DATABASE_URL is not set');
  });

  // Like DATABASE_URL: the URL holds a password, and startup errors end up in logs.
  it('names a malformed QUEUE_DATABASE_URL without showing its password', () => {
    let message = '';
    try {
      loadWorkerConfig({ DATABASE_URL, QUEUE_DATABASE_URL: 'mysql://u:s3cretpw@h/d' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe('QUEUE_DATABASE_URL is not a postgresql:// URL');
    expect(message).not.toContain('s3cretpw');
  });

  // ADR 0021: the api never gets the queue's credentials, so its config never reads them.
  it('is the only config that reads QUEUE_DATABASE_URL', () => {
    expect(loadConfig({ DATABASE_URL, QUEUE_DATABASE_URL })).not.toHaveProperty('queueDatabaseUrl');
  });
});
