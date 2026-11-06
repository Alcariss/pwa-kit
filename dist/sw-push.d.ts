/**
 * Push handlers that run inside the generated service worker. `definePwaApp`
 * emits them as `pwa-kit-push-sw.js` and loads them with workbox
 * `importScripts`, so the precache and update prompt stay as they are.
 *
 * `installPushHandlers` is serialised with `toString()`: it must not use
 * anything from outside its own body.
 */
/** What a push from the worker carries (see `worker/src/push.ts`). */
export type PushPayload = {
    title?: string;
    body?: string;
    /** Opened when the notification is tapped; relative to the app's scope. */
    url?: string;
    icon?: string;
    tag?: string;
};
type ExtendableEvent = {
    waitUntil(promise: Promise<unknown>): void;
};
type PushEvent = ExtendableEvent & {
    data: {
        json(): unknown;
        text(): string;
    } | null;
};
type NotificationClickEvent = ExtendableEvent & {
    notification: {
        close(): void;
        data?: {
            url?: unknown;
        } | null;
    };
};
type WindowClientLike = {
    url: string;
    focus(): Promise<unknown>;
};
/** The parts of `ServiceWorkerGlobalScope` the handlers use. */
export type PushScope = {
    registration: {
        scope: string;
        showNotification(title: string, options?: NotificationOptions): Promise<void>;
        getNotifications(): Promise<{
            close(): void;
        }[]>;
    };
    clients: {
        matchAll(options: {
            type: 'window';
            includeUncontrolled: boolean;
        }): Promise<readonly WindowClientLike[]>;
        openWindow(url: string): Promise<unknown>;
    };
    navigator: {
        setAppBadge?(count?: number): Promise<void>;
        clearAppBadge?(): Promise<void>;
    };
    addEventListener(type: 'push', listener: (event: PushEvent) => void): void;
    addEventListener(type: 'notificationclick', listener: (event: NotificationClickEvent) => void): void;
};
export declare function installPushHandlers(scope: PushScope): void;
/** File name of the emitted handler script, next to `sw.js`. */
export declare const PUSH_SW_FILE = "pwa-kit-push-sw.js";
/** The script `definePwaApp` emits. */
export declare function pushServiceWorkerSource(): string;
export {};
