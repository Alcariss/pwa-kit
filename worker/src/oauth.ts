import type { AuthProvider } from '../../src/contract.js';
import type { Env } from './env.js';

export type OAuthProvider = {
  name: AuthProvider;
  authorizeUrl(params: { redirectUri: string; state: string }): string;
  /** Trades the callback `code` for an access token. */
  exchangeCode(params: { code: string; redirectUri: string }, fetchImpl: typeof fetch): Promise<string>;
  /** Email addresses the provider has verified for the user. */
  verifiedEmails(accessToken: string, fetchImpl: typeof fetch): Promise<string[]>;
};

const TIMEOUT_MS = 10_000;

async function getJson(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<unknown> {
  const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`${new URL(url).host} returned HTTP ${response.status}`);
  }
  return response.json();
}

async function exchange(
  fetchImpl: typeof fetch,
  tokenUrl: string,
  form: Record<string, string>
): Promise<string> {
  const body = (await getJson(fetchImpl, tokenUrl, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString()
  })) as { access_token?: unknown; error?: unknown };
  // GitHub reports a bad code as HTTP 200 with an `error` field.
  if (typeof body.access_token !== 'string') {
    throw new Error(`${new URL(tokenUrl).host} refused the code: ${String(body.error ?? 'no access_token')}`);
  }
  return body.access_token;
}

function google(clientId: string, clientSecret: string): OAuthProvider {
  return {
    name: 'google',
    authorizeUrl({ redirectUri, state }) {
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email',
        state,
        prompt: 'select_account'
      }).toString();
      return url.toString();
    },
    exchangeCode({ code, redirectUri }, fetchImpl) {
      return exchange(fetchImpl, 'https://oauth2.googleapis.com/token', {
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      });
    },
    async verifiedEmails(accessToken, fetchImpl) {
      const user = (await getJson(fetchImpl, 'https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` }
      })) as { email?: unknown; email_verified?: unknown };
      return user.email_verified === true && typeof user.email === 'string' ? [user.email] : [];
    }
  };
}

function github(clientId: string, clientSecret: string): OAuthProvider {
  return {
    name: 'github',
    authorizeUrl({ redirectUri, state }) {
      const url = new URL('https://github.com/login/oauth/authorize');
      url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: 'user:email',
        state,
        allow_signup: 'false'
      }).toString();
      return url.toString();
    },
    exchangeCode({ code, redirectUri }, fetchImpl) {
      return exchange(fetchImpl, 'https://github.com/login/oauth/access_token', {
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri
      });
    },
    async verifiedEmails(accessToken, fetchImpl) {
      const emails = (await getJson(fetchImpl, 'https://api.github.com/user/emails', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'pwa-kit-api',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      })) as { email?: unknown; verified?: unknown }[];
      return emails
        .filter((entry) => entry.verified === true && typeof entry.email === 'string')
        .map((entry) => entry.email as string);
    }
  };
}

/** The provider, or null when its client id and secret are not set. */
export function getProvider(name: string, env: Env): OAuthProvider | null {
  if (name === 'google' && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    return google(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
  }
  if (name === 'github' && env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
    return github(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET);
  }
  return null;
}
