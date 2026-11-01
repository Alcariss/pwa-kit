import { describe, expect, it, vi } from 'vitest';
import { createAuth } from './auth.js';
import type { KeyValueStorage } from './cache.js';
import type { SessionClaims } from './contract.js';

const API_URL = 'https://api.example/notes';
const APP_URL = 'https://alcariss.github.io/notes/';
const NOW_MS = Date.parse('2026-11-01T12:00:00.000Z');
const NOW_S = NOW_MS / 1000;

function encode(value: object): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function token(overrides: Partial<SessionClaims> = {}): string {
  const claims: SessionClaims = {
    purpose: 'session',
    sub: 'jan@example.com',
    app: 'notes',
    iat: NOW_S,
    exp: NOW_S + 3600,
    ...overrides
  };
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}.signature`;
}

function setup(hash = '') {
  const values = new Map<string, string>();
  const storage: KeyValueStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key)
  };
  const location = { href: `${APP_URL}${hash}`, hash, assign: vi.fn() };
  const history = { replaceState: vi.fn() };
  const auth = createAuth({ apiUrl: API_URL, storage, location, history, now: () => NOW_MS });
  return { auth, values, location, history };
}

describe('createAuth', () => {
  it('stores the session from the sign-in redirect and strips it from the address bar', () => {
    const jwt = token();
    const { auth, values, history } = setup(`#session=${jwt}`);

    const outcome = auth.completeLogin();

    expect(outcome).toMatchObject({ status: 'signed-in', session: { email: 'jan@example.com' } });
    expect(values.get('pwa-kit:session:notes')).toBe(jwt);
    expect(history.replaceState).toHaveBeenCalledWith(null, '', APP_URL);
  });

  it('refuses a session issued for another app', () => {
    const { auth, values } = setup(`#session=${token({ app: 'period' })}`);

    expect(auth.completeLogin()).toEqual({ status: 'failed', reason: 'invalid_session' });
    expect(values.size).toBe(0);
  });

  it('reports the reason the worker gave for a failed sign-in', () => {
    const { auth } = setup('#auth_error=not_allowed');

    expect(auth.completeLogin()).toEqual({ status: 'failed', reason: 'not_allowed' });
  });

  it('forgets an expired session', () => {
    const { auth, values } = setup();
    values.set('pwa-kit:session:notes', token({ exp: NOW_S - 1 }));

    expect(auth.current()).toBeNull();
    expect(values.size).toBe(0);
  });

  it('sends the user to the worker sign-in route with the app and return address', () => {
    const { auth, location } = setup('#stale');

    auth.login('github');

    const target = new URL(String(location.assign.mock.calls[0]?.[0]));
    expect(target.origin + target.pathname).toBe('https://api.example/auth/login');
    expect(Object.fromEntries(target.searchParams)).toEqual({
      app: 'notes',
      provider: 'github',
      return_to: APP_URL
    });
  });
});
