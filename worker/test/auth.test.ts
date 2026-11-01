import { describe, expect, it } from 'vitest';
import { APP_ORIGIN, ME, setup } from './harness.js';

const RETURN_TO = `${APP_ORIGIN}/notes/`;

function loginPath(provider: string, returnTo = RETURN_TO): string {
  const params = new URLSearchParams({ app: 'notes', provider, return_to: returnTo });
  return `/auth/login?${params.toString()}`;
}

/** Follows the flow the browser would: login -> provider -> callback. */
async function signIn(harness: ReturnType<typeof setup>, provider: string, options: { cookie?: string } = {}) {
  const login = await harness.send(loginPath(provider));
  const providerUrl = new URL(login.headers.get('Location') ?? '');
  const state = providerUrl.searchParams.get('state') ?? '';
  const cookie = options.cookie ?? (login.headers.get('Set-Cookie') ?? '').split(';')[0] ?? '';
  const callback = await harness.send(`/auth/callback?code=abc&state=${encodeURIComponent(state)}`, {
    headers: { Cookie: cookie }
  });
  return { login, providerUrl, callback };
}

function fragmentOf(response: Response): URLSearchParams {
  return new URLSearchParams(new URL(response.headers.get('Location') ?? '').hash.slice(1));
}

describe('sign-in', () => {
  it('refuses to hand a session to an address outside the app\'s origins', async () => {
    const { send } = setup();

    const response = await send(loginPath('google', 'https://evil.example/steal'));

    expect(response.status).toBe(400);
    expect(response.headers.get('Location')).toBeNull();
  });

  it('refuses a provider that has no client credentials', async () => {
    const { send } = setup({ GITHUB_CLIENT_SECRET: undefined });

    const response = await send(loginPath('github'));

    expect(response.status).toBe(400);
  });

  it('sends the user to Google with a callback on this worker and a browser-bound nonce', async () => {
    const harness = setup();

    const { login, providerUrl } = await signIn(harness, 'google');

    expect(providerUrl.origin + providerUrl.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(providerUrl.searchParams.get('redirect_uri')).toBe('https://api.example/auth/callback');
    expect(login.headers.get('Set-Cookie')).toMatch(/^__Host-pwakit_nonce=[\w-]+; Path=\/; Max-Age=600; HttpOnly; Secure; SameSite=Lax$/);
  });

  it('returns a working session in the URL fragment for an allowed Google account', async () => {
    const harness = setup();

    const { callback } = await signIn(harness, 'google');
    const session = fragmentOf(callback).get('session') ?? '';
    const api = await harness.send('/notes?action=fetch', { headers: { Authorization: `Bearer ${session}` } });

    expect(callback.status).toBe(302);
    expect(callback.headers.get('Location')?.startsWith(`${RETURN_TO}#session=`)).toBe(true);
    expect(api.status).toBe(200);
  });

  it('matches the allowlist without regard to letter case', async () => {
    const harness = setup();
    harness.backends.googleUser = { email: 'Partner@Example.com', email_verified: true };

    const { callback } = await signIn(harness, 'google');

    expect(fragmentOf(callback).has('session')).toBe(true);
  });

  it('refuses an account that is not on the allowlist', async () => {
    const harness = setup();
    harness.backends.googleUser = { email: 'stranger@example.com', email_verified: true };

    const { callback } = await signIn(harness, 'google');

    expect(Object.fromEntries(fragmentOf(callback))).toEqual({ auth_error: 'not_allowed' });
  });

  it('refuses an allowed address Google has not verified', async () => {
    const harness = setup();
    harness.backends.googleUser = { email: ME, email_verified: false };

    const { callback } = await signIn(harness, 'google');

    expect(Object.fromEntries(fragmentOf(callback))).toEqual({ auth_error: 'not_allowed' });
  });

  it('ignores unverified GitHub addresses', async () => {
    const harness = setup();
    harness.backends.githubEmails = [{ email: ME, verified: false }];

    const { callback } = await signIn(harness, 'github');

    expect(Object.fromEntries(fragmentOf(callback))).toEqual({ auth_error: 'not_allowed' });
  });

  it('signs in with a verified GitHub address', async () => {
    const harness = setup();
    harness.backends.githubEmails = [
      { email: 'old@example.com', verified: true },
      { email: ME, verified: true }
    ];

    const { callback } = await signIn(harness, 'github');

    expect(fragmentOf(callback).has('session')).toBe(true);
  });

  it('refuses a callback from a browser that did not start the sign-in', async () => {
    const harness = setup();

    const { callback } = await signIn(harness, 'google', { cookie: '__Host-pwakit_nonce=someone-else' });

    expect(callback.status).toBe(400);
    expect(callback.headers.get('Location')).toBeNull();
  });

  it('reports a cancelled sign-in back to the app', async () => {
    const harness = setup();
    const login = await harness.send(loginPath('google'));
    const state = new URL(login.headers.get('Location') ?? '').searchParams.get('state') ?? '';

    const callback = await harness.send(`/auth/callback?error=access_denied&state=${encodeURIComponent(state)}`, {
      headers: { Cookie: (login.headers.get('Set-Cookie') ?? '').split(';')[0] ?? '' }
    });

    expect(Object.fromEntries(fragmentOf(callback))).toEqual({ auth_error: 'cancelled' });
  });
});
