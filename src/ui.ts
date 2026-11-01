import { AUTH_ERRORS, type AuthProvider, type Diagnostics } from './contract.js';

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

/** Escapes text for interpolation into `innerHTML`, including attribute values. */
export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

export function requiredElement<T extends Element = HTMLElement>(
  selector: string,
  root: ParentNode = document
): T {
  const element = root.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Required element not found: ${selector}`);
  }
  return element;
}

/** "just now", "5 minutes ago", "3 hours ago", in the given locale. */
export function formatAge(ageMs: number, locale?: string): string {
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
export function renderDiagnostics(
  target: HTMLElement,
  diagnostics: Diagnostics | null,
  extra: Readonly<Record<string, string>> = {}
): void {
  if (diagnostics === null) {
    target.replaceChildren();
    return;
  }

  const rows: [string, string][] = [
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

type RegisterSWOptions = {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
  onRegisteredSW?: (swScriptUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
  onRegisterError?: (error: unknown) => void;
};

/** `registerSW` from `virtual:pwa-register`. */
export type RegisterSW = (options?: RegisterSWOptions) => (reloadPage?: boolean) => Promise<void>;

export type UpdatePromptOptions = {
  message?: string;
  buttonLabel?: string;
  /** How often an open app checks for a new deploy. */
  checkIntervalMs?: number;
};

/**
 * Registers the service worker and shows a banner when a new version is
 * waiting. The new version only takes over when the user clicks, so nobody
 * loses a half-filled form to a reload.
 */
export function setupUpdatePrompt(registerSW: RegisterSW, options: UpdatePromptOptions = {}): void {
  const message = options.message ?? 'A new version is available.';
  const buttonLabel = options.buttonLabel ?? 'Update';
  const checkIntervalMs = options.checkIntervalMs ?? 60_000;
  let banner: HTMLElement | null = null;

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
      const check = (): void => {
        if (navigator.onLine) {
          registration.update().catch((error: unknown) => {
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

export const DEFAULT_PROVIDER_LABELS: Record<AuthProvider, string> = {
  google: 'Continue with Google',
  github: 'Continue with GitHub'
};

export const DEFAULT_AUTH_ERROR_MESSAGES: Record<string, string> = {
  [AUTH_ERRORS.CANCELLED]: 'Sign-in was cancelled.',
  [AUTH_ERRORS.NOT_ALLOWED]: 'This account has no access to the app.',
  [AUTH_ERRORS.PROVIDER_ERROR]: 'Sign-in failed. Try again.',
  invalid_session: 'Sign-in failed. Try again.'
};

export type LoginScreenOptions = {
  title: string;
  providers: readonly AuthProvider[];
  onSelect(provider: AuthProvider): void;
  /** Shown above the buttons, e.g. why the previous attempt failed. */
  message?: string | null;
  labels?: Partial<Record<AuthProvider, string>>;
};

export function renderLoginScreen(target: HTMLElement, options: LoginScreenOptions): void {
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
