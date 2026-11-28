export interface ApiConfig {
  databaseUrl: string;
  /** Where the API listens: this computer only unless set (containers use 0.0.0.0). */
  host: string;
  port: number;
  jsonLogs: boolean;
  /**
   * Cookies get `Secure` and `__Host-` names (ADR 0009). True unless COOKIE_SECURE=false, which
   * only plain-HTTP local development sets.
   */
  cookieSecure?: boolean;
  /** How email leaves (ADR 0040); tests pass a fake mailer instead. */
  mail?: MailSettings;
  /** The web app's address, the start of every emailed link. No trailing slash. */
  appUrl?: string;
  /** Module 00 #45: the demo's SES sandbox reaches verified addresses only. */
  emailLimited?: boolean;
  /**
   * ADR 0016's 2026-11-24 note: this server is the public demo. It offers the one-click demo
   * login and lets the worker build a fresh demo shop each week. Off everywhere else.
   */
  demoEnabled?: boolean;
}

/** ADR 0040: Mailpit through SMTP on this computer, SES on the server, or no email at all. */
export type MailSettings =
  | { transport: 'none' }
  | { transport: 'smtp'; smtpUrl: string; from: string }
  | { transport: 'ses'; region: string; from: string };

/**
 * Reads a PostgreSQL URL from the environment. Errors name the variable but never show its
 * value: the URL holds a password, and startup errors end up in logs.
 */
export function readDatabaseUrl(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  if (!URL.canParse(value) || !['postgres:', 'postgresql:'].includes(new URL(value).protocol)) {
    throw new Error(`${name} is not a postgresql:// URL`);
  }
  return value;
}

function readHost(value: string | undefined): string {
  if (value === undefined) return '127.0.0.1';
  if (value.trim() === '') throw new Error('HOST must not be empty');
  return value;
}

function readFlag(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const value = env[name];
  if (value === undefined) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

// Like readDatabaseUrl: errors name the variable, never its value.
function readUrl(env: NodeJS.ProcessEnv, name: string, protocols: string[], what: string): string {
  const value = env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  if (!URL.canParse(value) || !protocols.includes(new URL(value).protocol)) {
    throw new Error(`${name} is not ${what} URL`);
  }
  return value;
}

function readMailFrom(env: NodeJS.ProcessEnv): string {
  const value = env.MAIL_FROM;
  if (value === undefined || value === '') throw new Error('MAIL_FROM is not set');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error('MAIL_FROM is not an email address');
  }
  return value;
}

function readMail(env: NodeJS.ProcessEnv): MailSettings {
  switch (env.MAIL_TRANSPORT ?? 'none') {
    case 'none':
      return { transport: 'none' };
    case 'smtp':
      return {
        transport: 'smtp',
        smtpUrl: readUrl(env, 'SMTP_URL', ['smtp:', 'smtps:'], 'an smtp://'),
        from: readMailFrom(env),
      };
    case 'ses':
      return { transport: 'ses', region: env.AWS_REGION ?? 'ap-south-1', from: readMailFrom(env) };
    default:
      throw new Error('MAIL_TRANSPORT must be none, smtp or ses');
  }
}

/** Where emailed links point when APP_URL is unset: the web app under `pnpm dev`. */
export const DEFAULT_APP_URL = 'http://127.0.0.1:5173';

function readAppUrl(env: NodeJS.ProcessEnv): string {
  if (env.APP_URL === undefined) return DEFAULT_APP_URL;
  return readUrl(env, 'APP_URL', ['http:', 'https:'], 'an http(s)').replace(/\/+$/, '');
}

function readPort(value: string | undefined): number {
  if (value === undefined) return 3000;
  const port = Number(value);
  if (value.trim() === '' || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be a whole number from 1 to 65535');
  }
  return port;
}

/** Settings for the api and worker processes, checked once at startup. */
export function loadConfig(env: NodeJS.ProcessEnv): ApiConfig {
  return {
    databaseUrl: readDatabaseUrl(env, 'DATABASE_URL'),
    host: readHost(env.HOST),
    port: readPort(env.PORT),
    jsonLogs: env.NODE_ENV === 'production',
    cookieSecure: readFlag(env, 'COOKIE_SECURE', true),
    mail: readMail(env),
    appUrl: readAppUrl(env),
    emailLimited: readFlag(env, 'EMAIL_LIMITED', false),
    demoEnabled: readFlag(env, 'DEMO_ENABLED', false),
  };
}

/** What the worker reads: the api's settings, plus the job queue's own database login (ADR 0022). */
export interface WorkerConfig extends ApiConfig {
  queueDatabaseUrl: string;
}

/**
 * Only the worker reads QUEUE_DATABASE_URL; the api's `loadConfig` never does, so the api
 * can't be handed the queue's credentials by mistake (ADR 0021).
 */
export function loadWorkerConfig(env: NodeJS.ProcessEnv): WorkerConfig {
  return { ...loadConfig(env), queueDatabaseUrl: readDatabaseUrl(env, 'QUEUE_DATABASE_URL') };
}
