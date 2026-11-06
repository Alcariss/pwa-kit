import { detectInstallTarget, readInstallEnvironment } from './install.js';
export function readPushEnvironment() {
    const supported = 'serviceWorker' in navigator && 'PushManager' in globalThis && 'Notification' in globalThis;
    return {
        serviceWorker: supported ? navigator.serviceWorker : null,
        notification: 'Notification' in globalThis ? Notification : null,
        badge: navigator,
        install: readInstallEnvironment()
    };
}
function base64UrlToBytes(value) {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
function sameBytes(buffer, bytes) {
    if (!buffer) {
        return false;
    }
    const other = new Uint8Array(buffer);
    return other.length === bytes.length && other.every((byte, index) => byte === bytes[index]);
}
const IOS_TARGETS = ['ios-safari', 'ios-safari-legacy', 'ipad-safari', 'ios-chrome', 'ios-browser', 'ios-open-in-safari', 'ios-in-app'];
export function createPushNotifications(client, options = {}) {
    const env = options.environment ?? readPushEnvironment();
    function support() {
        if (IOS_TARGETS.includes(detectInstallTarget(env.install))) {
            return 'needs-install';
        }
        if (env.serviceWorker === null || env.notification === null) {
            return 'unsupported';
        }
        return env.notification.permission === 'denied' ? 'denied' : null;
    }
    async function currentSubscription() {
        const registration = await env.serviceWorker?.getRegistration();
        return (await registration?.pushManager.getSubscription()) ?? null;
    }
    async function register(subscription) {
        await client.request('push-subscribe', { subscription: JSON.stringify(subscription.toJSON()) });
    }
    async function state() {
        const blocked = support();
        if (blocked !== null) {
            return blocked;
        }
        const subscription = await currentSubscription();
        return subscription !== null && env.notification?.permission === 'granted' ? 'on' : 'off';
    }
    async function enable() {
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
            client.request('push-key'),
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
        }
        catch (error) {
            // Better off than "on" while the worker does not know the device.
            await subscription.unsubscribe().catch(() => false);
            throw error;
        }
        return 'on';
    }
    async function disable() {
        const subscription = await currentSubscription();
        if (subscription !== null) {
            try {
                await client.request('push-unsubscribe', { endpoint: subscription.endpoint });
            }
            catch (error) {
                // The push service answers 410 for it from now on, and the worker forgets it then.
                console.warn('pwa-kit: could not unregister the push subscription', error);
            }
            await subscription.unsubscribe();
        }
        return support() ?? 'off';
    }
    async function sync() {
        if ((await state()) !== 'on') {
            return;
        }
        const subscription = await currentSubscription();
        if (subscription !== null) {
            await register(subscription);
        }
    }
    async function clearBadge() {
        try {
            await env.badge.clearAppBadge?.();
            const registration = await env.serviceWorker?.getRegistration();
            for (const notification of (await registration?.getNotifications?.()) ?? []) {
                notification.close();
            }
        }
        catch {
            // Badging is a nicety; nothing to tell the user.
        }
    }
    const onVisible = () => {
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
export const DEFAULT_PUSH_TOGGLE_STRINGS = {
    label: 'Notify me about new entries',
    denied: 'Notifications are blocked. Allow them for this app in the system settings.',
    needsInstall: 'To get notifications on iPhone or iPad, add the app to your Home Screen and open it from there.',
    unsupported: '',
    error: 'Could not change notifications. Try again.'
};
/**
 * Appends a notifications switch to `target`. Mount it once signed in: it
 * re-registers an existing subscription with the worker on the way.
 */
export function mountPushToggle(target, push, options = {}) {
    const strings = { ...DEFAULT_PUSH_TOGGLE_STRINGS, ...options.strings };
    const root = document.createElement('div');
    root.className = 'pk-push';
    target.append(root);
    let disposed = false;
    function note(text, className = 'pk-push-note') {
        const paragraph = document.createElement('p');
        paragraph.className = className;
        paragraph.textContent = text;
        return paragraph;
    }
    function render(current, error = false) {
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
            change.then((next) => render(next), async (reason) => {
                console.error('pwa-kit: notifications', reason);
                render(await push.state().catch(() => 'off'), true);
            });
        });
        root.replaceChildren(label, ...(error ? [note(strings.error, 'pk-push-note pk-push-error')] : []));
    }
    async function refresh() {
        const current = await push.state();
        if (!disposed) {
            render(current);
        }
        return current;
    }
    root.hidden = true;
    refresh().then((current) => current === 'on' ? push.sync() : undefined).catch((error) => console.warn('pwa-kit: push state or sync failed', error));
    return {
        refresh,
        dispose() {
            disposed = true;
            root.remove();
        }
    };
}
