import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const DATABASE_URL = 'postgresql://app_runtime:pw@127.0.0.1:5432/business_software';

describe('loadConfig', () => {
  it('reads the database URL and defaults the rest', () => {
    expect(loadConfig({ DATABASE_URL })).toEqual({
      databaseUrl: DATABASE_URL,
      host: '127.0.0.1',
      port: 3000,
      jsonLogs: false,
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
    });
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
});
