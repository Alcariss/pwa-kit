import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from './api.js';
import { ApiError } from './api.js';
import { createPushNotifications, mountPushToggle, type PushEnvironment, type PushNotifications } from './push.js';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
// Uncompressed P-256 point: 0x04 followed by 64 bytes.
const PUBLIC_KEY_BYTES = new Uint8Array([4, ...Array.from({ length: 64 }, (_, index) => index)]);
const PUBLIC_KEY = btoa(String.fromCharCode(...PUBLIC_KEY_BYTES)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function fakeSubscription(endpoint: string, key: Uint8Array = PUBLIC_KEY_BYTES) {
  return {
    endpoint,
    options: { applicationServerKey: key.slice().buffer },
    toJSON: () => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribe: vi.fn(async () => true)
  };
}

type Fake = ReturnType<typeof fakeSubscription>;

function fakeBrowser(options: { userAgent?: string; standalone?: boolean; permission?: NotificationPermission; answer?: NotificationPermission } = {}) {
  let subscription: Fake | null = null;
  const notification = {
    permission: options.permission ?? 'default',
    requestPermission: vi.fn(async () => {
      notification.permission = options.answer ?? 'granted';
      return notification.permission;
    })
  };
  const shown = [{ close: vi.fn() }, { close: vi.fn() }];
  const registration = {
    pushManager: {
      getSubscription: vi.fn(async () => subscription),
      subscribe: vi.fn(async ({ applicationServerKey }: { applicationServerKey: Uint8Array }) => {
        subscription = fakeSubscription('https://web.push.apple.com/new', applicationServerKey);
        return subscription;
      })
    },
    getNotifications: vi.fn(async () => shown)
  };
  const badge = { clearAppBadge: vi.fn(async () => undefined) };
  const environment: PushEnvironment = {
    serviceWorker: { ready: Promise.resolve(registration), getRegistration: async () => registration },
    notification,
    badge,
    install: { userAgent: options.userAgent ?? ANDROID, maxTouchPoints: 5, standalone: options.standalone ?? false }
  };
  return {
    environment,
    notification,
    registration,
    badge,
    shown,
    get subscription() {
      return subscription;
    },
    set subscription(value: Fake | null) {
      subscription = value;
    }
  };
}

function fakeClient(fail: string[] = []) {
  const request = vi.fn(async (action: string, params: Record<string, unknown> = {}) => {
    void params;
    if (fail.includes(action)) {
      throw new ApiError('UPSTREAM_ERROR', 'down', 502);
    }
    return {
      data: action === 'push-key' ? { publicKey: PUBLIC_KEY } : { subscribed: action === 'push-subscribe' },
      diagnostics: { endpoint: '', source: 'primary' as const, fetchedAt: '', cacheAgeSeconds: null, error: null }
    };
  });
  return { client: { request } as unknown as ApiClient, request };
}

let push: PushNotifications | null = null;
afterEach(() => {
  push?.dispose();
  push = null;
  document.body.replaceChildren();
});

describe('createPushNotifications', () => {
  it('asks iOS users in a browser tab to install first', async () => {
    const browser = fakeBrowser({ userAgent: IPHONE });
    push = createPushNotifications(fakeClient().client, { environment: browser.environment });

    expect(await push.state()).toBe('needs-install');
    expect(await push.enable()).toBe('needs-install');
    expect(browser.notification.requestPermission).not.toHaveBeenCalled();
  });

  it('works in the installed iOS app', async () => {
    const browser = fakeBrowser({ userAgent: IPHONE, standalone: true });
    push = createPushNotifications(fakeClient().client, { environment: browser.environment });

    expect(await push.state()).toBe('off');
  });

  it('reports browsers without the Push API', async () => {
    const browser = fakeBrowser();
    push = createPushNotifications(fakeClient().client, {
      environment: { ...browser.environment, serviceWorker: null }
    });

    expect(await push.state()).toBe('unsupported');
  });

  it('enables: permission first, then subscribe with the VAPID key and register with the worker', async () => {
    const browser = fakeBrowser();
    const { client, request } = fakeClient();
    push = createPushNotifications(client, { environment: browser.environment });

    expect(await push.enable()).toBe('on');

    expect(browser.notification.requestPermission).toHaveBeenCalledOnce();
    expect(browser.notification.requestPermission.mock.invocationCallOrder[0])
      .toBeLessThan(request.mock.invocationCallOrder[0] ?? 0);
    expect(browser.registration.pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: PUBLIC_KEY_BYTES
    });
    expect(request).toHaveBeenLastCalledWith('push-subscribe', {
      subscription: JSON.stringify({ endpoint: 'https://web.push.apple.com/new', keys: { p256dh: 'p', auth: 'a' } })
    });
    expect(await push.state()).toBe('on');
  });

  it('stays off when the user says no', async () => {
    const browser = fakeBrowser({ answer: 'denied' });
    const { client, request } = fakeClient();
    push = createPushNotifications(client, { environment: browser.environment });

    expect(await push.enable()).toBe('denied');
    expect(request).not.toHaveBeenCalled();
    expect(await push.state()).toBe('denied');
  });

  it('replaces a subscription made with another VAPID key', async () => {
    const browser = fakeBrowser({ permission: 'granted' });
    const old = fakeSubscription('https://web.push.apple.com/old', new Uint8Array(65));
    browser.subscription = old;
    push = createPushNotifications(fakeClient().client, { environment: browser.environment });

    await push.enable();

    expect(old.unsubscribe).toHaveBeenCalled();
    expect(browser.subscription?.endpoint).toBe('https://web.push.apple.com/new');
  });

  it('rolls the subscription back when the worker cannot store it', async () => {
    const browser = fakeBrowser();
    push = createPushNotifications(fakeClient(['push-subscribe']).client, { environment: browser.environment });

    await expect(push.enable()).rejects.toThrow('down');

    expect(browser.subscription?.unsubscribe).toHaveBeenCalled();
  });

  it('disables: unregisters with the worker and unsubscribes, even when the worker is down', async () => {
    const browser = fakeBrowser({ permission: 'granted' });
    const subscription = fakeSubscription('https://web.push.apple.com/mine');
    browser.subscription = subscription;
    const { client, request } = fakeClient(['push-unsubscribe']);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    push = createPushNotifications(client, { environment: browser.environment });

    expect(await push.disable()).toBe('off');

    expect(request).toHaveBeenCalledWith('push-unsubscribe', { endpoint: 'https://web.push.apple.com/mine' });
    expect(subscription.unsubscribe).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('sync re-registers an existing subscription and does nothing when off', async () => {
    const browser = fakeBrowser({ permission: 'granted' });
    const { client, request } = fakeClient();
    push = createPushNotifications(client, { environment: browser.environment });

    await push.sync();
    expect(request).not.toHaveBeenCalled();

    browser.subscription = fakeSubscription('https://web.push.apple.com/mine');
    await push.sync();
    expect(request).toHaveBeenCalledWith('push-subscribe', expect.objectContaining({ subscription: expect.any(String) }));
  });

  it('clears the badge and shown notifications when the app is opened', async () => {
    const browser = fakeBrowser();
    push = createPushNotifications(fakeClient().client, { environment: browser.environment });
    await vi.waitFor(() => expect(browser.badge.clearAppBadge).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(browser.shown[0]?.close).toHaveBeenCalled());

    document.dispatchEvent(new Event('visibilitychange'));

    await vi.waitFor(() => expect(browser.badge.clearAppBadge).toHaveBeenCalledTimes(2));
  });
});

describe('mountPushToggle', () => {
  it('renders a switch that turns notifications on', async () => {
    const browser = fakeBrowser();
    push = createPushNotifications(fakeClient().client, { environment: browser.environment, clearBadgeOnVisible: false });

    mountPushToggle(document.body, push, { strings: { label: 'Upozornění na nové hlášky' } });
    const input = await vi.waitFor(() => {
      const element = document.querySelector<HTMLInputElement>('.pk-push-toggle input');
      expect(element).not.toBeNull();
      return element as HTMLInputElement;
    });
    expect(document.querySelector('.pk-push-toggle')?.textContent).toBe('Upozornění na nové hlášky');
    expect(input.checked).toBe(false);

    input.checked = true;
    input.dispatchEvent(new Event('change'));

    await vi.waitFor(() => expect(document.querySelector('.pk-push')?.getAttribute('data-state')).toBe('on'));
    expect(document.querySelector<HTMLInputElement>('.pk-push-toggle input')?.checked).toBe(true);
  });

  it('shows the install note on iOS in a browser tab, or nothing when it is emptied', async () => {
    const browser = fakeBrowser({ userAgent: IPHONE });
    push = createPushNotifications(fakeClient().client, { environment: browser.environment, clearBadgeOnVisible: false });

    mountPushToggle(document.body, push, { strings: { needsInstall: 'Přidejte si aplikaci na plochu.' } });
    await vi.waitFor(() => expect(document.querySelector('.pk-push-note')?.textContent).toBe('Přidejte si aplikaci na plochu.'));

    document.body.replaceChildren();
    mountPushToggle(document.body, push, { strings: { needsInstall: '' } });
    await vi.waitFor(() => expect(document.querySelector<HTMLElement>('.pk-push')?.dataset.state).toBe('needs-install'));
    expect(document.querySelector<HTMLElement>('.pk-push')?.hidden).toBe(true);
  });

  it('shows an error and the real state when enabling fails', async () => {
    const browser = fakeBrowser();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    push = createPushNotifications(fakeClient(['push-key']).client, { environment: browser.environment, clearBadgeOnVisible: false });

    mountPushToggle(document.body, push);
    const input = await vi.waitFor(() => {
      const element = document.querySelector<HTMLInputElement>('.pk-push-toggle input');
      expect(element).not.toBeNull();
      return element as HTMLInputElement;
    });
    input.checked = true;
    input.dispatchEvent(new Event('change'));

    await vi.waitFor(() => expect(document.querySelector('.pk-push-error')).not.toBeNull());
    expect(document.querySelector<HTMLInputElement>('.pk-push-toggle input')?.checked).toBe(false);
    vi.restoreAllMocks();
  });

  it('re-registers an existing subscription when mounted', async () => {
    const browser = fakeBrowser({ permission: 'granted' });
    browser.subscription = fakeSubscription('https://web.push.apple.com/mine');
    const { client, request } = fakeClient();
    push = createPushNotifications(client, { environment: browser.environment, clearBadgeOnVisible: false });

    mountPushToggle(document.body, push);

    await vi.waitFor(() => expect(request).toHaveBeenCalledWith('push-subscribe', expect.anything()));
  });
});
