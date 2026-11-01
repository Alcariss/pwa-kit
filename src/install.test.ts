import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectInstallTarget, setupInstallHint, type InstallEnvironment, type InstallHint } from './install.js';

const UA = {
  iphoneSafari18: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1',
  iphoneSafari26: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.88 Mobile/15E148 Safari/604.1',
  iphoneChromeOld: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/110.0.5481.83 Mobile/15E148 Safari/604.1',
  iphoneFirefox: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/125.0 Mobile/15E148 Safari/605.1.15',
  iphoneEdge: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/124.0.2478.50 Mobile/15E148 Safari/605.1.15',
  iphoneMessenger: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21E236 [FBAN/MessengerForiOS;FBAV/455.0.0.36.109;FBBV/1;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.4]',
  iphoneInstagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.3.12.235 (iPhone15,2; iOS 17_4; cs_CZ; cs; scale=3.00; 1179x2556)',
  iphoneGoogleApp: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/312.0.625098639 Mobile/15E148 Safari/604.1',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  androidWebView: 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  windowsFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0'
};

function env(userAgent: string, overrides: Partial<InstallEnvironment> = {}): InstallEnvironment {
  return { userAgent, maxTouchPoints: /iPhone|Android/.test(userAgent) ? 5 : 0, standalone: false, ...overrides };
}

describe('detectInstallTarget', () => {
  it.each([
    ['iphoneSafari18', 'ios-safari-legacy'],
    ['iphoneSafari26', 'ios-safari'],
    ['iphoneChrome', 'ios-chrome'],
    ['iphoneChromeOld', 'ios-open-in-safari'],
    ['iphoneFirefox', 'ios-browser'],
    ['iphoneEdge', 'ios-browser'],
    ['iphoneMessenger', 'ios-in-app'],
    ['iphoneInstagram', 'ios-in-app'],
    ['iphoneGoogleApp', 'ios-in-app'],
    ['androidChrome', 'android'],
    ['androidWebView', 'android-in-app'],
    ['macSafari', 'mac-safari'],
    ['macChrome', 'desktop'],
    ['windowsFirefox', 'unsupported']
  ] as const)('%s -> %s', (name, expected) => {
    expect(detectInstallTarget(env(UA[name]))).toBe(expected);
  });

  it('recognises an iPad behind its Mac user agent', () => {
    expect(detectInstallTarget(env(UA.ipadDesktop, { maxTouchPoints: 5 }))).toBe('ipad-safari');
  });

  it('reports an installed app as standalone', () => {
    expect(detectInstallTarget(env(UA.iphoneSafari26, { standalone: true }))).toBe('standalone');
  });
});

const KEY = 'test:install-hint-dismissed';
let hint: InstallHint | null = null;

afterEach(() => {
  hint?.dispose();
  hint = null;
  localStorage.clear();
  document.body.replaceChildren();
});

function firePrompt(outcome: 'accepted' | 'dismissed') {
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: vi.fn().mockResolvedValue(undefined),
    userChoice: Promise.resolve({ outcome })
  });
  window.dispatchEvent(event);
  return event;
}

describe('setupInstallHint', () => {
  it('shows the steps for the detected browser', () => {
    hint = setupInstallHint(document.body, { storageKey: KEY, environment: env(UA.iphoneSafari26) });

    const steps = [...document.querySelectorAll('.pk-install-hint-steps li')].map((li) => li.textContent);
    expect(hint.target).toBe('ios-safari');
    expect(steps[0]).toContain('⋯');
  });

  it('uses the app\'s own strings', () => {
    hint = setupInstallHint(document.body, {
      storageKey: KEY,
      environment: env(UA.iphoneMessenger),
      signInRequired: true,
      strings: { title: 'Nainstalujte si aplikaci', iosInApp: ['Otevřete stránku v Safari.'], signInNote: 'Pak se přihlaste.' }
    });

    expect(document.querySelector('.pk-install-hint-title')?.textContent).toBe('Nainstalujte si aplikaci');
    expect(document.querySelector('.pk-install-hint-steps')?.textContent).toBe('Otevřete stránku v Safari.');
    expect(document.querySelector('.pk-install-hint-note')?.textContent).toBe('Pak se přihlaste.');
  });

  it('renders nothing in the installed app', () => {
    hint = setupInstallHint(document.body, { storageKey: KEY, environment: env(UA.iphoneSafari26, { standalone: true }) });

    expect(document.querySelector('.pk-install-hint')).toBeNull();
  });

  it('remembers a dismissal under the app\'s key', () => {
    hint = setupInstallHint(document.body, { storageKey: KEY, environment: env(UA.iphoneSafari18) });
    document.querySelector<HTMLButtonElement>('.pk-install-hint-dismiss')?.click();

    expect(document.querySelector('.pk-install-hint')).toBeNull();
    expect(localStorage.getItem(KEY)).not.toBeNull();

    hint = setupInstallHint(document.body, { storageKey: KEY, environment: env(UA.iphoneSafari18) });
    expect(document.querySelector('.pk-install-hint')).toBeNull();

    hint = setupInstallHint(document.body, { storageKey: 'other:install-hint-dismissed', environment: env(UA.iphoneSafari18) });
    expect(document.querySelector('.pk-install-hint')).not.toBeNull();
  });

  it('waits on the desktop until the browser offers to install', async () => {
    hint = setupInstallHint(document.body, { storageKey: KEY, environment: env(UA.macChrome) });
    expect(document.querySelector('.pk-install-hint')).toBeNull();

    const event = firePrompt('accepted');
    expect(event.defaultPrevented).toBe(true);
    document.querySelector<HTMLButtonElement>('.pk-install-hint-install')?.click();
    await vi.waitFor(() => expect(document.querySelector('.pk-install-hint')).toBeNull());
    expect(event.prompt).toHaveBeenCalled();
  });

  it('swaps the Android steps for an Install button, and back if the user declines', async () => {
    hint = setupInstallHint(document.body, { storageKey: KEY, environment: env(UA.androidChrome) });
    expect(document.querySelector('.pk-install-hint-steps')).not.toBeNull();

    firePrompt('dismissed');
    expect(document.querySelector('.pk-install-hint-steps')).toBeNull();
    document.querySelector<HTMLButtonElement>('.pk-install-hint-install')?.click();

    await vi.waitFor(() => expect(document.querySelector('.pk-install-hint-steps')).not.toBeNull());
    expect(document.querySelector('.pk-install-hint-install')).toBeNull();
  });

  it('leaves the browser prompt alone when no hint is shown', () => {
    expect(firePrompt('dismissed').defaultPrevented).toBe(false);
  });
});
