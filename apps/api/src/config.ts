export interface ApiConfig {
  databaseUrl: string;
  /** Where the API listens: this computer only unless set (containers use 0.0.0.0). */
  host: string;
  port: number;
  jsonLogs: boolean;
}

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
  };
}
