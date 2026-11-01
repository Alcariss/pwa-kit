import { createHandler, type Env } from '../src/index.js';
import { issueSession } from '../src/tokens.js';

export const NOW_MS = Date.parse('2026-11-01T12:00:00.000Z');
export const NOW_S = NOW_MS / 1000;
export const WORKER = 'https://api.example';
export const APP_ORIGIN = 'https://alcariss.github.io';
export const ME = 'me@example.com';
export const PARTNER = 'partner@example.com';

export function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    GRIST_API_KEY: 'grist-key',
    SESSION_SECRET: 'test-secret-that-is-long-enough',
    GRIST_BASE_URL: 'https://grist.example',
    DEV_ORIGINS: 'http://localhost:5173',
    GOOGLE_CLIENT_ID: 'google-id',
    GOOGLE_CLIENT_SECRET: 'google-secret',
    GITHUB_CLIENT_ID: 'github-id',
    GITHUB_CLIENT_SECRET: 'github-secret',
    ALLOWED_EMAILS_NOTES: `${ME}, ${PARTNER.toUpperCase()}`,
    ...overrides
  };
}

export function sessionFor(email: string, app = 'notes', issuedAt = NOW_S, ttl = 3600): Promise<string> {
  return issueSession(email, app, 'test-secret-that-is-long-enough', issuedAt, ttl);
}

type Call = { method: string; url: URL; body: unknown };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * Just enough of the Grist records API and the two OAuth providers for the
 * worker to run end to end in memory.
 */
export class FakeBackends {
  readonly rows = new Map<number, Record<string, unknown>>();
  readonly calls: Call[] = [];
  gristDown = false;
  googleUser: { email: string; email_verified: boolean } = { email: ME, email_verified: true };
  githubEmails: { email: string; verified: boolean }[] = [{ email: ME, verified: true }];
  private nextId = 1;

  seed(fields: Record<string, unknown>): number {
    const id = this.nextId++;
    this.rows.set(id, fields);
    return id;
  }

  gristCalls(): Call[] {
    return this.calls.filter((call) => call.url.host === 'grist.example');
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' && /^[[{]/.test(init.body) ? JSON.parse(init.body) : init?.body;
    this.calls.push({ method, url, body });

    if (url.host === 'grist.example') {
      return this.grist(method, url, body);
    }
    if (url.href === 'https://oauth2.googleapis.com/token') {
      return json({ access_token: 'google-access' });
    }
    if (url.href === 'https://openidconnect.googleapis.com/v1/userinfo') {
      return json(this.googleUser);
    }
    if (url.href === 'https://github.com/login/oauth/access_token') {
      return json({ access_token: 'github-access' });
    }
    if (url.href === 'https://api.github.com/user/emails') {
      return json(this.githubEmails);
    }
    return new Response('unexpected request', { status: 599 });
  };

  private grist(method: string, url: URL, body: unknown): Response {
    if (this.gristDown) {
      return new Response('down', { status: 503 });
    }
    if (url.pathname.endsWith('/records') && method === 'GET') {
      const filter = JSON.parse(url.searchParams.get('filter') ?? '{}') as Record<string, unknown[]>;
      const records = [...this.rows]
        .filter(([id, fields]) => Object.entries(filter).every(([column, values]) =>
          values.includes(column === 'id' ? id : fields[column])))
        .map(([id, fields]) => ({ id, fields }));
      return json({ records });
    }
    if (url.pathname.endsWith('/records') && method === 'POST') {
      const [record] = (body as { records: { fields: Record<string, unknown> }[] }).records;
      return json({ records: [{ id: this.seed(record?.fields ?? {}) }] });
    }
    if (url.pathname.endsWith('/records') && method === 'PATCH') {
      for (const record of (body as { records: { id: number; fields: Record<string, unknown> }[] }).records) {
        this.rows.set(record.id, { ...this.rows.get(record.id), ...record.fields });
      }
      return json({});
    }
    if (url.pathname.endsWith('/apply') && method === 'POST') {
      for (const [action, , id] of body as [string, string, number][]) {
        if (action === 'RemoveRecord') {
          this.rows.delete(id);
        }
      }
      return json({});
    }
    return new Response('unknown Grist route', { status: 404 });
  }
}

export function setup(envOverrides: Partial<Env> = {}) {
  const backends = new FakeBackends();
  const env = testEnv(envOverrides);
  const handle = createHandler({ fetch: backends.fetch, now: () => NOW_MS });
  return {
    backends,
    env,
    send: (path: string, init: RequestInit = {}) => handle(new Request(`${WORKER}${path}`, init), env)
  };
}
