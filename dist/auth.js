import { appIdFromEndpoint } from './contract.js';
function decodeBase64Url(value) {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
    return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}
/**
 * Reads the claims of a session token without verifying it. Only the worker
 * can verify the signature; the app reads the claims to know who is signed in
 * and when to ask for sign-in again.
 */
export function decodeSessionClaims(token) {
    const payload = token.split('.')[1];
    if (!payload) {
        return null;
    }
    try {
        const claims = JSON.parse(decodeBase64Url(payload));
        if (claims.purpose !== 'session'
            || typeof claims.sub !== 'string'
            || typeof claims.app !== 'string'
            || typeof claims.exp !== 'number'
            || typeof claims.iat !== 'number') {
            return null;
        }
        return claims;
    }
    catch {
        return null;
    }
}
function withoutHash(href) {
    const url = new URL(href);
    url.hash = '';
    return url.toString();
}
export function createAuth(options) {
    const storage = options.storage ?? globalThis.localStorage;
    const location = options.location ?? globalThis.location;
    const history = options.history ?? globalThis.history;
    const now = options.now ?? Date.now;
    const appId = appIdFromEndpoint(options.apiUrl);
    const storageKey = `pwa-kit:session:${appId}`;
    function toSession(token) {
        const claims = decodeSessionClaims(token);
        if (claims === null || claims.app !== appId || claims.exp * 1000 <= now()) {
            return null;
        }
        return { token, email: claims.sub, expiresAt: new Date(claims.exp * 1000) };
    }
    return {
        current() {
            const token = storage.getItem(storageKey);
            if (token === null) {
                return null;
            }
            const session = toSession(token);
            if (session === null) {
                storage.removeItem(storageKey);
            }
            return session;
        },
        completeLogin() {
            const fragment = new URLSearchParams(location.hash.replace(/^#/, ''));
            const token = fragment.get('session');
            const error = fragment.get('auth_error');
            if (token === null && error === null) {
                return { status: 'none' };
            }
            // The fragment holds a credential: remove it from the address bar and history at once.
            history.replaceState(null, '', withoutHash(location.href));
            if (error !== null) {
                return { status: 'failed', reason: error };
            }
            const session = toSession(token ?? '');
            if (session === null) {
                return { status: 'failed', reason: 'invalid_session' };
            }
            storage.setItem(storageKey, session.token);
            return { status: 'signed-in', session };
        },
        login(provider) {
            const url = new URL('/auth/login', options.apiUrl);
            url.searchParams.set('app', appId);
            url.searchParams.set('provider', provider);
            url.searchParams.set('return_to', withoutHash(location.href));
            location.assign(url.toString());
        },
        logout() {
            storage.removeItem(storageKey);
        }
    };
}
