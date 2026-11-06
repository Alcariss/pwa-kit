import { describe, expect, it, vi } from 'vitest';
import { installPushHandlers, pushServiceWorkerSource, type PushScope } from './sw-push.js';

const SCOPE = 'https://alcariss.github.io/hanushlasky/';

function fakeScope(windows: { url: string; focus: () => Promise<unknown> }[] = []) {
  const listeners = new Map<string, (event: unknown) => void>();
  const shown: { close(): void }[] = [];
  const scope = {
    registration: {
      scope: SCOPE,
      showNotification: vi.fn(async () => {
        shown.push({ close: () => undefined });
      }),
      getNotifications: vi.fn(async () => shown)
    },
    clients: {
      matchAll: vi.fn(async () => windows),
      openWindow: vi.fn(async () => null)
    },
    navigator: {
      setAppBadge: vi.fn(async () => undefined),
      clearAppBadge: vi.fn(async () => undefined)
    },
    addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener)
  };
  installPushHandlers(scope as unknown as PushScope);

  async function dispatch(type: string, event: Record<string, unknown>): Promise<void> {
    const pending: Promise<unknown>[] = [];
    listeners.get(type)?.({ ...event, waitUntil: (promise: Promise<unknown>) => pending.push(promise) });
    await Promise.all(pending);
  }

  return { scope, dispatch };
}

const pushData = (value: unknown) => ({ data: { json: () => value, text: () => JSON.stringify(value) } });

describe('push handler', () => {
  it('shows the notification and sets the badge to the number shown', async () => {
    const { scope, dispatch } = fakeScope();

    await dispatch('push', pushData({ title: 'Hlášky', body: 'Ahoj', url: SCOPE, tag: 'quote' }));
    await dispatch('push', pushData({ title: 'Hlášky', body: 'Čau' }));

    expect(scope.registration.showNotification).toHaveBeenNthCalledWith(1, 'Hlášky', {
      body: 'Ahoj',
      icon: `${SCOPE}pwa-192x192.png`,
      data: { url: SCOPE },
      tag: 'quote'
    });
    expect(scope.navigator.setAppBadge).toHaveBeenLastCalledWith(2);
  });

  it('still shows something for a payload that is not JSON', async () => {
    const { scope, dispatch } = fakeScope();

    await dispatch('push', { data: { json: () => { throw new SyntaxError('x'); }, text: () => 'plain' } });

    expect(scope.registration.showNotification).toHaveBeenCalledWith('', expect.objectContaining({ body: 'plain' }));
  });
});

describe('notificationclick handler', () => {
  const click = (url: string) => ({ notification: { close: vi.fn(), data: { url } } });

  it('focuses an open window of the app and clears the badge', async () => {
    const focus = vi.fn(async () => undefined);
    const { scope, dispatch } = fakeScope([{ url: 'https://alcariss.github.io/other/', focus: vi.fn() }, { url: `${SCOPE}#x`, focus }]);

    await dispatch('notificationclick', click(SCOPE));

    expect(focus).toHaveBeenCalled();
    expect(scope.clients.openWindow).not.toHaveBeenCalled();
    expect(scope.navigator.clearAppBadge).toHaveBeenCalled();
  });

  it('opens the click URL when the app is not open', async () => {
    const { scope, dispatch } = fakeScope();
    const event = click(SCOPE);

    await dispatch('notificationclick', event);

    expect(event.notification.close).toHaveBeenCalled();
    expect(scope.clients.openWindow).toHaveBeenCalledWith(SCOPE);
  });
});

describe('pushServiceWorkerSource', () => {
  it('is a self-contained script that installs the handlers on `self`', () => {
    const source = pushServiceWorkerSource();
    const self = { registration: { scope: SCOPE }, addEventListener: vi.fn() };

    new Function('self', source)(self);

    expect(self.addEventListener.mock.calls.map(([type]) => type)).toEqual(['push', 'notificationclick']);
  });
});
