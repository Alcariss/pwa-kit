import { AUTH_ERRORS } from '../../src/contract.js';
import { getApp } from './apps.js';
import { allowedEmails, devOrigins, nowSeconds, sessionTtlSeconds, type Deps, type Env } from './env.js';
import { readCookie, redirect, textPage } from './http.js';
import { getProvider } from './oauth.js';
import { issueSession, randomToken, signToken, verifyToken } from './tokens.js';

/**
 * Sign-in flow:
 *   app  -> GET /auth/login?app&provider&return_to   (sets a nonce cookie, signs the state)
 *        -> provider sign-in page
 *        -> GET /auth/callback?code&state              (checks state + cookie, verified email, allowlist)
 *        -> 302 return_to#session=<token>             (or #auth_error=<reason>)
 * The session travels in the fragment, which browsers never send to a server.
 */

const NONCE_COOKIE = '__Host-pwakit_nonce';
const STATE_TTL_SECONDS = 600;

type OAuthState = {
  purpose: 'oauth-state';
  nonce: string;
  app: string;
  provider: string;
  returnTo: string;
  exp: number;
};

function callbackUrl(url: URL): string {
  return `${url.origin}/auth/callback`;
}

function nonceCookie(value: string, maxAge: number): string {
  return `${NONCE_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

/** The return address without its fragment, if its origin is one the app is hosted on. */
function parseReturnTo(raw: string | null, allowedOrigins: readonly string[]): string | null {
  if (raw === null) {
    return null;
  }
  try {
    const url = new URL(raw);
    if (!allowedOrigins.includes(url.origin)) {
      return null;
    }
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function asOAuthState(claims: Record<string, unknown> | null): OAuthState | null {
  if (
    claims === null
    || typeof claims.nonce !== 'string'
    || typeof claims.app !== 'string'
    || typeof claims.provider !== 'string'
    || typeof claims.returnTo !== 'string'
  ) {
    return null;
  }
  return claims as OAuthState;
}

export async function startLogin(url: URL, env: Env, deps: Deps): Promise<Response> {
  const appId = url.searchParams.get('app') ?? '';
  const app = getApp(appId);
  if (app === null) {
    return textPage(`Unknown app "${appId}".`, 400);
  }

  const provider = getProvider(url.searchParams.get('provider') ?? '', env);
  if (provider === null) {
    return textPage('This sign-in provider is not configured.', 400);
  }

  const returnTo = parseReturnTo(url.searchParams.get('return_to'), [...app.origins, ...devOrigins(env)]);
  if (returnTo === null) {
    return textPage('return_to is not an address this app is hosted on.', 400);
  }

  if (!env.SESSION_SECRET) {
    return textPage('The worker is missing SESSION_SECRET.', 500);
  }

  const nonce = randomToken();
  const state: OAuthState = {
    purpose: 'oauth-state',
    nonce,
    app: appId,
    provider: provider.name,
    returnTo,
    exp: nowSeconds(deps) + STATE_TTL_SECONDS
  };
  const location = provider.authorizeUrl({
    redirectUri: callbackUrl(url),
    state: await signToken(state, env.SESSION_SECRET)
  });
  return redirect(location, { 'Set-Cookie': nonceCookie(nonce, STATE_TTL_SECONDS) });
}

export async function finishLogin(request: Request, url: URL, env: Env, deps: Deps): Promise<Response> {
  if (!env.SESSION_SECRET) {
    return textPage('The worker is missing SESSION_SECRET.', 500);
  }

  const state = asOAuthState(
    await verifyToken(url.searchParams.get('state') ?? '', env.SESSION_SECRET, 'oauth-state', nowSeconds(deps))
  );
  if (state === null) {
    return textPage('This sign-in link has expired. Go back to the app and sign in again.', 400);
  }

  // Binds the callback to the browser that started sign-in, so nobody can log you into their account.
  if (readCookie(request.headers.get('Cookie'), NONCE_COOKIE) !== state.nonce) {
    return textPage('Sign-in was started in a different browser. Go back to the app and sign in again.', 400);
  }

  const backToApp = (fragment: Record<string, string>): Response =>
    redirect(`${state.returnTo}#${new URLSearchParams(fragment).toString()}`, {
      'Set-Cookie': nonceCookie('', 0)
    });

  if (url.searchParams.has('error')) {
    return backToApp({ auth_error: AUTH_ERRORS.CANCELLED });
  }

  const provider = getProvider(state.provider, env);
  const code = url.searchParams.get('code');
  if (provider === null || code === null) {
    return backToApp({ auth_error: AUTH_ERRORS.PROVIDER_ERROR });
  }

  let emails: string[];
  try {
    const accessToken = await provider.exchangeCode({ code, redirectUri: callbackUrl(url) }, deps.fetch);
    emails = await provider.verifiedEmails(accessToken, deps.fetch);
  } catch (error) {
    console.error(JSON.stringify({ event: 'sign_in_failed', app: state.app, provider: state.provider, error: String(error) }));
    return backToApp({ auth_error: AUTH_ERRORS.PROVIDER_ERROR });
  }

  const allowed = allowedEmails(env, state.app);
  const email = emails.map((candidate) => candidate.toLowerCase()).find((candidate) => allowed.has(candidate));
  if (email === undefined) {
    console.warn(JSON.stringify({ event: 'sign_in_refused', app: state.app, provider: state.provider }));
    return backToApp({ auth_error: AUTH_ERRORS.NOT_ALLOWED });
  }

  const session = await issueSession(email, state.app, env.SESSION_SECRET, nowSeconds(deps), sessionTtlSeconds(env));
  return backToApp({ session });
}
