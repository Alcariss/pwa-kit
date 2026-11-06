/**
 * Web Push from the app itself: asks for permission, subscribes the device
 * with the worker's VAPID key and registers it with the worker, which then
 * notifies it whenever someone else adds a record.
 */
import type { ApiClient } from './api.js';
import { detectInstallTarget, readInstallEnvironment, type InstallEnvironment } from './install.js';

export type PushState =
  /** No service worker, Push API or Notification API here (or iOS before 16.4). */
  | 'unsupported'
  /** iOS/iPadOS in a browser tab: Web Push only works once added to the Home Screen. */
  | 'needs-install'
  /** The user blocked notifications; only the system settings can undo it. */
  | 'denied'
  | 'off'
  | 'on';

type SubscriptionLike = {
  endpoint: string;
  options?: { applicationServerKey?: ArrayBuffer | null };
  toJSON(): unknown;
  unsubscribe(): Promise<boolean>;
};

type RegistrationLike = {
  pushManager: {
    getSubscription(): Promise<SubscriptionLike | null>;
    subscribe(options: { userVisibleOnly: boolean; applicationServerKey: Uint8Array }): Promise<SubscriptionLike>;
  };
  getNotifications?(): Promise<{ close(): void }[]>;
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
  badge: { clearAppBadge?(): Promise<void> };
  install: InstallEnvironment;
};

export function readPushEnvironment(): PushEnvironment {
  const supported = 'serviceWorker' in navigator && 'PushManager' in globalThis && 'Notification' in globalThis;
  return {
    serviceWorker: supported ? (navigator.serviceWorker as unknown as PushEnvironment['serviceWorker']) : null,
    notification: 'Notification' in globalThis ? Notification : null,
    badge: navigator as PushEnvironment['badge'],
    install: readInstallEnvironment()
  };
}

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

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function sameBytes(buffer: ArrayBuffer | null | undefined, bytes: Uint8Array): boolean {
  if (!buffer) {
    return false;
  }
  const other = new Uint8Array(buffer);
  return other.length === bytes.length && other.every((byte, index) => byte === bytes[index]);
}

const IOS_TARGETS = ['ios-safari', 'ios-safari-legacy', 'ipad-safari', 'ios-chrome', 'ios-browser', 'ios-open-in-safari', 'ios-in-app'];

export function createPushNotifications(client: ApiClient, options: PushNotificationsOptions = {}): PushNotifications {
  const env = options.environment ?? readPushEnvironment();

  function support(): PushState | null {
    if (IOS_TARGETS.includes(detectInstallTarget(env.install))) {
      return 'needs-install';
    }
    if (env.serviceWorker === null || env.notification === null) {
      return 'unsupported';
    }
    return env.notification.permission === 'denied' ? 'denied' : null;
  }

  async function currentSubscription(): Promise<SubscriptionLike | null> {
    const registration = await env.serviceWorker?.getRegistration();
    return (await registration?.pushManager.getSubscription()) ?? null;
  }

  async function register(subscription: SubscriptionLike): Promise<void> {
    await client.request('push-subscribe', { subscription: JSON.stringify(subscription.toJSON()) });
  }

  async function state(): Promise<PushState> {
    const blocked = support();
    if (blocked !== null) {
      return blocked;
    }
    const subscription = await currentSubscription();
    return subscription !== null && env.notification?.permission === 'granted' ? 'on' : 'off';
  }

  async function enable(): Promise<PushState> {
    const blocked = support();
    if (blocked !== null || env.serviceWorker === null || env.notification === null) {
      return blocked ?? 'unsupported';
    }
    // First, before any other await, so the click still counts as a user gesture.
    const permission = await env.notification.requestPermission();
    if (permission !== 'granted') {
      return permission === 'denied' ? 'denied' : 'off';
    }

    const [{ data }, registration] = await Promise.all([
      client.request<{ publicKey: string }>('push-key'),
      env.serviceWorker.ready
    ]);
    const key = base64UrlToBytes(data.publicKey);
    let subscription = await registration.pushManager.getSubscription();
    if (subscription !== null && !sameBytes(subscription.options?.applicationServerKey, key)) {
      // Subscribed under an older VAPID key: the worker can no longer reach it.
      await subscription.unsubscribe();
      subscription = null;
    }
    subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    try {
      await register(subscription);
    } catch (error) {
      // Better off than "on" while the worker does not know the device.
      await subscription.unsubscribe().catch(() => false);
      throw error;
    }
    return 'on';
  }

  async function disable(): Promise<PushState> {
    const subscription = await currentSubscription();
    if (subscription !== null) {
      try {
        await client.request('push-unsubscribe', { endpoint: subscription.endpoint });
      } catch (error) {
        // The push service answers 410 for it from now on, and the worker forgets it then.
        console.warn('pwa-kit: could not unregister the push subscription', error);
      }
      await subscription.unsubscribe();
    }
    return support() ?? 'off';
  }

  async function sync(): Promise<void> {
    if ((await state()) !== 'on') {
      return;
    }
    const subscription = await currentSubscription();
    if (subscription !== null) {
      await register(subscription);
    }
  }

  async function clearBadge(): Promise<void> {
    try {
      await env.badge.clearAppBadge?.();
      const registration = await env.serviceWorker?.getRegistration();
      for (const notification of (await registration?.getNotifications?.()) ?? []) {
        notification.close();
      }
    } catch {
      // Badging is a nicety; nothing to tell the user.
    }
  }

  const onVisible = (): void => {
    if (document.visibilityState === 'visible') {
      void clearBadge();
    }
  };
  if (options.clearBadgeOnVisible !== false && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisible);
    onVisible();
  }

  return {
    state,
    enable,
    disable,
    sync,
    clearBadge,
    dispose: () => document.removeEventListener('visibilitychange', onVisible)
  };
}

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

export const DEFAULT_PUSH_TOGGLE_STRINGS: PushToggleStrings = {
  label: 'Notify me about new entries',
  denied: 'Notifications are blocked. Allow them for this app in the system settings.',
  needsInstall: 'To get notifications on iPhone or iPad, add the app to your Home Screen and open it from there.',
  unsupported: '',
  error: 'Could not change notifications. Try again.'
};

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
export function mountPushToggle(
  target: HTMLElement,
  push: PushNotifications,
  options: PushToggleOptions = {}
): PushToggle {
  const strings = { ...DEFAULT_PUSH_TOGGLE_STRINGS, ...options.strings };
  const root = document.createElement('div');
  root.className = 'pk-push';
  target.append(root);
  let disposed = false;

  function note(text: string, className = 'pk-push-note'): HTMLElement {
    const paragraph = document.createElement('p');
    paragraph.className = className;
    paragraph.textContent = text;
    return paragraph;
  }

  function render(current: PushState, error = false): void {
    root.dataset.state = current;
    if (current === 'needs-install' || current === 'unsupported' || current === 'denied') {
      const text = current === 'needs-install' ? strings.needsInstall : current === 'denied' ? strings.denied : strings.unsupported;
      root.replaceChildren(...(text ? [note(text)] : []));
      root.hidden = text === '';
      return;
    }

    root.hidden = false;
    const label = document.createElement('label');
    label.className = 'pk-push-toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('role', 'switch');
    input.checked = current === 'on';
    const text = document.createElement('span');
    text.textContent = strings.label;
    label.append(input, text);
    input.addEventListener('change', () => {
      input.disabled = true;
      // Not awaited before the call: `enable` must start inside the gesture.
      const change = input.checked ? push.enable() : push.disable();
      change.then(
        (next) => render(next),
        async (reason: unknown) => {
          console.error('pwa-kit: notifications', reason);
          render(await push.state().catch((): PushState => 'off'), true);
        }
      );
    });
    root.replaceChildren(label, ...(error ? [note(strings.error, 'pk-push-note pk-push-error')] : []));
  }

  async function refresh(): Promise<PushState> {
    const current = await push.state();
    if (!disposed) {
      render(current);
    }
    return current;
  }

  root.hidden = true;
  refresh().then(
    (current) => current === 'on' ? push.sync() : undefined
  ).catch((error: unknown) => console.warn('pwa-kit: push state or sync failed', error));

  return {
    refresh,
    dispose() {
      disposed = true;
      root.remove();
    }
  };
}
