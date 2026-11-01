import { AUTH_PROVIDERS } from './contract.js';
const DEFAULT_TIMEOUT_MS = 10_000;
function readOptional(env, key) {
    const value = env[key];
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function readTimeout(env) {
    const raw = readOptional(env, 'VITE_API_TIMEOUT_MS');
    const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}
function readProviders(env) {
    const raw = readOptional(env, 'VITE_AUTH_PROVIDERS');
    if (raw === null) {
        return [];
    }
    return raw.split(',').map((name) => {
        const provider = name.trim();
        if (!AUTH_PROVIDERS.includes(provider)) {
            throw new Error(`VITE_AUTH_PROVIDERS: unknown provider "${name}", expected ${AUTH_PROVIDERS.join(', ')}`);
        }
        return provider;
    });
}
/**
 * Reads the API settings from Vite env variables. Pass `import.meta.env`:
 * Vite only substitutes it inside the app's own source, not inside the kit.
 */
export function readApiConfig(env) {
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
export function isDebugEnabled(search = globalThis.location?.search ?? '') {
    return new URLSearchParams(search).get('debug') === '1';
}
