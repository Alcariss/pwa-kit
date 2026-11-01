import type { KeyValueStorage } from './cache.js';
import { type AuthProvider, type SessionClaims } from './contract.js';
export type Session = {
    token: string;
    email: string;
    expiresAt: Date;
};
export type LoginOutcome = {
    status: 'none';
} | {
    status: 'signed-in';
    session: Session;
} | {
    status: 'failed';
    reason: string;
};
export type Auth = {
    /** The stored session, or null when signed out or expired. */
    current(): Session | null;
    /** Call once on start-up: picks up the result of a sign-in redirect from the URL fragment. */
    completeLogin(): LoginOutcome;
    /** Leaves the app for the provider's sign-in page. */
    login(provider: AuthProvider): void;
    /** Forgets the session. Also clear the app's cached data (`store.clear()`). */
    logout(): void;
};
export type AuthOptions = {
    /** The app's API endpoint, e.g. `https://pwa-kit-api.example.workers.dev/notes`. */
    apiUrl: string;
    storage?: KeyValueStorage;
    location?: Pick<Location, 'href' | 'hash' | 'assign'>;
    history?: Pick<History, 'replaceState'>;
    now?: () => number;
};
/**
 * Reads the claims of a session token without verifying it. Only the worker
 * can verify the signature; the app reads the claims to know who is signed in
 * and when to ask for sign-in again.
 */
export declare function decodeSessionClaims(token: string): SessionClaims | null;
export declare function createAuth(options: AuthOptions): Auth;
