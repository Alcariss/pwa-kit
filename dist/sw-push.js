/**
 * Push handlers that run inside the generated service worker. `definePwaApp`
 * emits them as `pwa-kit-push-sw.js` and loads them with workbox
 * `importScripts`, so the precache and update prompt stay as they are.
 *
 * `installPushHandlers` is serialised with `toString()`: it must not use
 * anything from outside its own body.
 */
export function installPushHandlers(scope) {
    const appScope = scope.registration.scope;
    /** Badge = notifications still in the notification centre. */
    async function updateBadge() {
        const nav = scope.navigator;
        if (typeof nav.setAppBadge !== 'function') {
            return;
        }
        try {
            const open = await scope.registration.getNotifications();
            await (open.length > 0 ? nav.setAppBadge(open.length) : nav.clearAppBadge?.());
        }
        catch {
            await nav.setAppBadge().catch(() => undefined);
        }
    }
    scope.addEventListener('push', (event) => {
        let payload = {};
        try {
            const data = event.data?.json();
            if (typeof data === 'object' && data !== null) {
                payload = data;
            }
        }
        catch {
            payload = { body: event.data?.text() ?? '' };
        }
        const text = (value) => (typeof value === 'string' && value !== '' ? value : undefined);
        const options = {
            body: text(payload.body) ?? '',
            icon: new URL(text(payload.icon) ?? 'pwa-192x192.png', appScope).href,
            data: { url: new URL(text(payload.url) ?? './', appScope).href }
        };
        const tag = text(payload.tag);
        if (tag !== undefined) {
            options.tag = tag;
        }
        // iOS revokes the subscription of a worker that receives a push without showing one.
        event.waitUntil(scope.registration.showNotification(text(payload.title) ?? '', options).then(updateBadge));
    });
    scope.addEventListener('notificationclick', (event) => {
        event.notification.close();
        const target = event.notification.data?.url;
        const url = typeof target === 'string' ? target : appScope;
        event.waitUntil((async () => {
            const windows = await scope.clients.matchAll({ type: 'window', includeUncontrolled: true });
            const open = windows.find((client) => client.url.startsWith(appScope));
            // An open window keeps its state (a half-written entry); it refreshes itself on focus.
            await (open ? open.focus() : scope.clients.openWindow(url));
            await scope.navigator.clearAppBadge?.().catch(() => undefined);
        })());
    });
}
/** File name of the emitted handler script, next to `sw.js`. */
export const PUSH_SW_FILE = 'pwa-kit-push-sw.js';
/** The script `definePwaApp` emits. */
export function pushServiceWorkerSource() {
    return `(${installPushHandlers.toString()})(self);\n`;
}
