import { AUTH_ERRORS } from './contract.js';
const HTML_ESCAPES = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
};
/** Escapes text for interpolation into `innerHTML`, including attribute values. */
export function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}
export function requiredElement(selector, root = document) {
    const element = root.querySelector(selector);
    if (element === null) {
        throw new Error(`Required element not found: ${selector}`);
    }
    return element;
}
/** "just now", "5 minutes ago", "3 hours ago", in the given locale. */
export function formatAge(ageMs, locale) {
    const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    const minutes = Math.round(ageMs / 60_000);
    if (minutes < 1) {
        return format.format(0, 'second');
    }
    if (minutes < 60) {
        return format.format(-minutes, 'minute');
    }
    const hours = Math.round(minutes / 60);
    if (hours < 24) {
        return format.format(-hours, 'hour');
    }
    return format.format(-Math.round(hours / 24), 'day');
}
/** Renders the `?debug=1` panel. Pass null to empty it. */
export function renderDiagnostics(target, diagnostics, extra = {}) {
    if (diagnostics === null) {
        target.replaceChildren();
        return;
    }
    const rows = [
        ['Endpoint', diagnostics.endpoint || 'n/a'],
        ['Source', diagnostics.source],
        ['Fetched', diagnostics.fetchedAt],
        ['Cache age', diagnostics.cacheAgeSeconds === null ? 'n/a' : `${diagnostics.cacheAgeSeconds} s`],
        ['Error', diagnostics.error ?? 'none'],
        ...Object.entries(extra)
    ];
    target.innerHTML = `
    <details class="pk-debug" open>
      <summary>Debug</summary>
      <dl>${rows.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join('')}</dl>
    </details>
  `;
}
/**
 * Registers the service worker and shows a banner when a new version is
 * waiting. The new version only takes over when the user clicks, so nobody
 * loses a half-filled form to a reload.
 */
export function setupUpdatePrompt(registerSW, options = {}) {
    const message = options.message ?? 'A new version is available.';
    const buttonLabel = options.buttonLabel ?? 'Update';
    const checkIntervalMs = options.checkIntervalMs ?? 60_000;
    let banner = null;
    const updateSW = registerSW({
        immediate: true,
        onNeedRefresh() {
            if (banner !== null) {
                return;
            }
            banner = document.createElement('div');
            banner.className = 'pk-update-banner';
            banner.setAttribute('role', 'status');
            const text = document.createElement('span');
            text.textContent = message;
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = buttonLabel;
            button.addEventListener('click', () => {
                button.disabled = true;
                void updateSW(true);
            });
            banner.append(text, button);
            document.body.prepend(banner);
        },
        onRegisteredSW(_swScriptUrl, registration) {
            if (registration === undefined) {
                return;
            }
            const check = () => {
                if (navigator.onLine) {
                    registration.update().catch((error) => {
                        console.warn('pwa-kit: update check failed', error);
                    });
                }
            };
            setInterval(check, checkIntervalMs);
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') {
                    check();
                }
            });
        },
        onRegisterError(error) {
            console.error('pwa-kit: service worker registration failed', error);
        }
    });
}
export const DEFAULT_PROVIDER_LABELS = {
    google: 'Continue with Google',
    github: 'Continue with GitHub'
};
export const DEFAULT_AUTH_ERROR_MESSAGES = {
    [AUTH_ERRORS.CANCELLED]: 'Sign-in was cancelled.',
    [AUTH_ERRORS.NOT_ALLOWED]: 'This account has no access to the app.',
    [AUTH_ERRORS.PROVIDER_ERROR]: 'Sign-in failed. Try again.',
    invalid_session: 'Sign-in failed. Try again.'
};
export function renderLoginScreen(target, options) {
    const section = document.createElement('section');
    section.className = 'pk-login';
    const heading = document.createElement('h1');
    heading.textContent = options.title;
    section.append(heading);
    if (options.message) {
        const message = document.createElement('p');
        message.className = 'pk-login-message';
        message.setAttribute('role', 'alert');
        message.textContent = options.message;
        section.append(message);
    }
    for (const provider of options.providers) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `pk-login-button pk-login-${provider}`;
        button.textContent = options.labels?.[provider] ?? DEFAULT_PROVIDER_LABELS[provider];
        button.addEventListener('click', () => options.onSelect(provider));
        section.append(button);
    }
    target.replaceChildren(section);
}
