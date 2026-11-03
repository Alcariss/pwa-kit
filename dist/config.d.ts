import { type AuthProvider } from './contract.js';
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
/**
 * Reads the API settings from Vite env variables. Pass `import.meta.env`:
 * Vite only substitutes it inside the app's own source, not inside the kit.
 */
export declare function readApiConfig(env: EnvLike): ApiConfig;
/** `?debug=1` in the address bar turns on the diagnostics panel. */
export declare function isDebugEnabled(search?: string): boolean;
