import { AUTH_PROVIDERS, type AuthProvider } from './contract.js';

export type ApiConfig = {
  primaryUrl: string;
  /** Legacy Apps Script backends only: second sheet tried on schema errors. */
  fallbackUrl: string | null;
  /** Legacy Apps Script backends only: shared token sent as `?token=`. */
  token: string | null;
  timeoutMs: number;
  /** Sign-in providers to offer; empty means the backend needs no sign-in. */
  authProviders: AuthProvider[];
};

/** `import.meta.env` or any plain record of build-time variables. */
export type EnvLike = Readonly<Record<string, unknown>>;

const DEFAULT_TIMEOUT_MS = 10_000;

function readOptional(env: EnvLike, key: string): string | null {
  const value = env[key];
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readTimeout(env: EnvLike): number {
  const raw = readOptional(env, 'VITE_API_TIMEOUT_MS');
  const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function readProviders(env: EnvLike): AuthProvider[] {
  const raw = readOptional(env, 'VITE_AUTH_PROVIDERS');
  if (raw === null) {
    return [];
  }

  return raw.split(',').map((name) => {
    const provider = name.trim() as AuthProvider;
    if (!AUTH_PROVIDERS.includes(provider)) {
      throw new Error(
        `VITE_AUTH_PROVIDERS: unknown provider "${name}", expected ${AUTH_PROVIDERS.join(', ')}`
      );
    }
    return provider;
  });
}

/**
 * Reads the API settings from Vite env variables. Pass `import.meta.env`:
 * Vite only substitutes it inside the app's own source, not inside the kit.
 */
export function readApiConfig(env: EnvLike): ApiConfig {
  const primaryUrl = readOptional(env, 'VITE_API_URL_PRIMARY');
  if (primaryUrl === null) {
    throw new Error('VITE_API_URL_PRIMARY is not set. Copy .env.example to .env and fill it in.');
  }
  new URL(primaryUrl);

  return {
    primaryUrl,
    fallbackUrl: readOptional(env, 'VITE_API_URL_FALLBACK'),
    token: readOptional(env, 'VITE_API_TOKEN'),
    timeoutMs: readTimeout(env),
    authProviders: readProviders(env)
  };
}

/** `?debug=1` in the address bar turns on the diagnostics panel. */
export function isDebugEnabled(search: string = globalThis.location?.search ?? ''): boolean {
  return new URLSearchParams(search).get('debug') === '1';
}
