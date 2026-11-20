// Test helpers for the API's HTTP tests: a browser that keeps cookies like Chrome, and a clock
// the test moves. Not built into dist (tsconfig.build.json).

export class FakeClock {
  time = Date.parse('2026-11-19T10:00:00Z');
  now() {
    return new Date(this.time);
  }
  advance(ms: number) {
    this.time += ms;
  }
}

export interface Answer {
  status: number;
  body: Record<string, unknown> | null;
  cookies: string[];
  headers: Headers;
}

/** One browser: keeps the cookies it is given and sends them back, like Chrome. */
export class Browser {
  readonly jar = new Map<string, string>();
  csrf = '';

  constructor(
    private readonly base: string,
    /** The client's address as Caddy reports it (X-Forwarded-For). */
    readonly ip: string,
  ) {}

  async call(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
    const response = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': this.ip,
        'sec-fetch-site': 'same-origin',
        cookie: [...this.jar].map(([name, value]) => `${name}=${value}`).join('; '),
        ...(this.csrf !== '' && { 'x-csrf-token': this.csrf }),
        ...extra,
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const cookies = response.headers.getSetCookie();
    for (const cookie of cookies) {
      const [pair = ''] = cookie.split(';');
      const [name = '', value = ''] = pair.split('=');
      if (/Max-Age=0(;|$)/.test(cookie)) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    const text = await response.text();
    const answer: Answer = {
      status: response.status,
      body: text === '' ? null : (JSON.parse(text) as Record<string, unknown>),
      cookies,
      headers: response.headers,
    };
    if (typeof answer.body?.csrfToken === 'string') this.csrf = answer.body.csrfToken;
    return answer;
  }

  /** Reads the session the way the web app does on load, picking up the CSRF token. */
  session() {
    return this.call('GET', '/session');
  }
}
