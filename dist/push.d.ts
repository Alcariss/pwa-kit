/**
 * Web Push from the app itself: asks for permission, subscribes the device
 * with the worker's VAPID key and registers it with the worker, which then
 * notifies it whenever someone else adds a record.
 */
import type { ApiClient } from './api.js';
import { type InstallEnvironment } from './install.js';
export type PushState = 
/** No service worker, Push API or Notification API here (or iOS before 16.4). */
'unsupported'
/** iOS/iPadOS in a browser tab: Web Push only works once added to the Home Screen. */
 | 'needs-install'
/** The user blocked notifications; only the system settings can undo it. */
 | 'denied' | 'off' | 'on';
type SubscriptionLike = {
    endpoint: string;
    options?: {
        applicationServerKey?: ArrayBuffer | null;
    };
    toJSON(): unknown;
    unsubscribe(): Promise<boolean>;
};
type RegistrationLike = {
    pushManager: {
        getSubscription(): Promise<SubscriptionLike | null>;
        subscribe(options: {
            userVisibleOnly: boolean;
            applicationServerKey: Uint8Array;
        }): Promise<SubscriptionLike>;
    };
    getNotifications?(): Promise<{
        close(): void;
    }[]>;
};
/** The browser APIs the helper uses; tests pass fakes. */
export type PushEnvironment = {
    /** Null where the Push API is missing. */
    serviceWorker: {
        ready: Promise<RegistrationLike>;
        getRegistration(): Promise<RegistrationLike | undefined>;
    } | null;
    /** Null where the Notification API is missing. */
    notification: {
        readonly permission: NotificationPermission;
        requestPermission(): Promise<NotificationPermission>;
    } | null;
    badge: {
        clearAppBadge?(): Promise<void>;
    };
    install: InstallEnvironment;
};
export declare function readPushEnvironment(): PushEnvironment;
export type PushNotificationsOptions = {
    /** Defaults to the current browser. */
    environment?: PushEnvironment;
    /** Clears the badge and shown notifications whenever the app becomes visible. Default true. */
    clearBadgeOnVisible?: boolean;
};
export type PushNotifications = {
    state(): Promise<PushState>;
    /**
     * Call straight from a click or tap: iOS only shows the permission prompt
     * for a user gesture. Resolves to the resulting state.
     */
    enable(): Promise<PushState>;
    disable(): Promise<PushState>;
    /** Re-registers this device's subscription with the worker, e.g. after sign-in. Quiet when off. */
    sync(): Promise<void>;
    /** Clears the app icon badge and the app's notifications in the notification centre. */
    clearBadge(): Promise<void>;
    /** Stops clearing the badge on visibility changes. */
    dispose(): void;
};
export declare function createPushNotifications(client: ApiClient, options?: PushNotificationsOptions): PushNotifications;
export type PushToggleStrings = {
    /** Text next to the switch. */
    label: string;
    denied: string;
    /** iOS in a browser tab. Empty renders nothing, e.g. when the app shows the install hint instead. */
    needsInstall: string;
    /** Empty renders nothing. */
    unsupported: string;
    error: string;
};
export declare const DEFAULT_PUSH_TOGGLE_STRINGS: PushToggleStrings;
export type PushToggleOptions = {
    strings?: Partial<PushToggleStrings>;
};
export type PushToggle = {
    /** Re-reads the state and redraws. */
    refresh(): Promise<PushState>;
    dispose(): void;
};
/**
 * Appends a notifications switch to `target`. Mount it once signed in: it
 * re-registers an existing subscription with the worker on the way.
 */
export declare function mountPushToggle(target: HTMLElement, push: PushNotifications, options?: PushToggleOptions): PushToggle;
export {};
