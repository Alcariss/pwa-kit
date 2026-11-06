/**
 * Install hint: tells the user how to add the app to their home screen, in
 * the words of the browser they are using. iOS has no install prompt, so it
 * gets instructions; Chromium gets a real Install button.
 */
export const DEFAULT_INSTALL_HINT_STRINGS = {
    title: 'Install the app',
    intro: 'Add it to your Home Screen to open it like an app, even offline.',
    promptIntro: 'Install it to open it like an app, even offline.',
    signInNote: 'The installed app does not share this browser\'s sign-in: install it first, then sign in there.',
    install: 'Install',
    dismiss: 'Not now',
    iosSafari: [
        'Tap ⋯ in the bottom-right corner.',
        'Tap Share.',
        'Tap Add to Home Screen (under More if you do not see it).',
        'Leave Open as Web App on and tap Add.'
    ],
    iosSafariLegacy: [
        'Tap Share (the square with an arrow) in the toolbar.',
        'Scroll down and tap Add to Home Screen.',
        'Tap Add.'
    ],
    ipadSafari: [
        'Tap Share (the square with an arrow) at the top. If it is not there, open the ⋯ menu first.',
        'Tap Add to Home Screen.',
        'Tap Add.'
    ],
    iosChrome: [
        'Tap Share (the square with an arrow) in the address bar.',
        'Tap Add to Home Screen (under More if you do not see it).',
        'Tap Add.'
    ],
    iosBrowser: [
        'Open the browser menu and tap Share.',
        'Tap Add to Home Screen (under More if you do not see it).',
        'Tap Add.'
    ],
    iosOpenInSafari: [
        'This browser cannot add apps to the Home Screen on this iOS version.',
        'Open this page in Safari, tap Share, then Add to Home Screen.'
    ],
    iosInApp: [
        'This page is open inside another app, which cannot add it to the Home Screen.',
        'Tap ⋯ or the compass icon and choose Open in Safari (or Open in browser).',
        'In Safari, tap Share, then Add to Home Screen.'
    ],
    androidInApp: [
        'This page is open inside another app, which cannot install it.',
        'Open the menu ⋮ and choose Open in Chrome (or Open in browser).'
    ],
    android: [
        'Open the browser menu ⋮.',
        'Tap Install app or Add to Home screen.'
    ],
    macSafari: ['Choose File → Add to Dock.']
};
const STEPS_BY_TARGET = {
    'ios-safari': 'iosSafari',
    'ios-safari-legacy': 'iosSafariLegacy',
    'ipad-safari': 'ipadSafari',
    'ios-chrome': 'iosChrome',
    'ios-browser': 'iosBrowser',
    'ios-open-in-safari': 'iosOpenInSafari',
    'ios-in-app': 'iosInApp',
    'android-in-app': 'androidInApp',
    android: 'android',
    'mac-safari': 'macSafari'
};
const IN_APP = /FBAN|FBAV|FB_IAB|FBIOS|Messenger|Instagram|WhatsApp|GSA\/|GmailApp|Line\/|Twitter|LinkedInApp|Snapchat|musical_ly|TikTok|Pinterest|MicroMessenger/i;
const IOS_OTHER_BROWSER = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|YaBrowser|DuckDuckGo|Ddg\//;
function versionOf(pattern, userAgent) {
    const match = pattern.exec(userAgent);
    return match ? Number(match[1]) + Number(match[2] ?? 0) / 100 : null;
}
export function readInstallEnvironment() {
    const nav = navigator;
    const displayModes = ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'];
    const standalone = nav.standalone === true
        || (typeof window.matchMedia === 'function'
            && displayModes.some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches));
    return { userAgent: nav.userAgent, maxTouchPoints: nav.maxTouchPoints ?? 0, standalone };
}
/** Works out which instructions fit this browser. Pure, so apps can test their own copy. */
export function detectInstallTarget(env) {
    const ua = env.userAgent;
    if (env.standalone) {
        return 'standalone';
    }
    const ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && env.maxTouchPoints > 1);
    if (/iPhone|iPod/.test(ua) || ipad) {
        // WKWebViews in other apps leave out the Safari token.
        if (IN_APP.test(ua) || !/Safari\//.test(ua)) {
            return 'ios-in-app';
        }
        if (IOS_OTHER_BROWSER.test(ua)) {
            const ios = versionOf(/OS (\d+)_(\d+)/, ua);
            if (ios !== null && ios < 16.04) {
                return 'ios-open-in-safari';
            }
            return /CriOS/.test(ua) ? 'ios-chrome' : 'ios-browser';
        }
        if (ipad) {
            return 'ipad-safari';
        }
        // Safari 26 freezes the OS in its user agent at 18_6; its own version is accurate.
        const safari = versionOf(/Version\/(\d+)(?:\.(\d+))?/, ua) ?? versionOf(/OS (\d+)_(\d+)/, ua);
        return safari !== null && safari >= 26 ? 'ios-safari' : 'ios-safari-legacy';
    }
    if (/Android/.test(ua)) {
        return IN_APP.test(ua) || /; wv\)/.test(ua) ? 'android-in-app' : 'android';
    }
    if (/Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg\/|Firefox|OPR\//.test(ua)) {
        const safari = versionOf(/Version\/(\d+)(?:\.(\d+))?/, ua);
        return safari !== null && safari >= 17 ? 'mac-safari' : 'unsupported';
    }
    if (/Chrome|Chromium|Edg\//.test(ua) && !/Firefox/.test(ua)) {
        return 'desktop';
    }
    return 'unsupported';
}
let deferredPrompt = null;
let listening = false;
const subscribers = new Set();
function notifySubscribers() {
    for (const subscriber of subscribers) {
        subscriber();
    }
}
function listenForPrompt() {
    if (listening) {
        return;
    }
    listening = true;
    window.addEventListener('beforeinstallprompt', (event) => {
        if (subscribers.size === 0) {
            return;
        }
        // Swaps Chrome's own mini-infobar for the hint's Install button.
        event.preventDefault();
        deferredPrompt = event;
        notifySubscribers();
    });
    window.addEventListener('appinstalled', () => {
        deferredPrompt = null;
        notifySubscribers();
    });
}
function isDismissed(key) {
    try {
        return localStorage.getItem(key) !== null;
    }
    catch {
        return false;
    }
}
function rememberDismissal(key) {
    try {
        localStorage.setItem(key, new Date().toISOString());
    }
    catch {
        // Private mode: the hint comes back next time, which is fine.
    }
}
/**
 * Appends an install hint to `target`, tailored to the browser. Renders
 * nothing when the app already runs installed or the user dismissed it. Show
 * it on the sign-in screen: an installed iOS app has its own storage, so a
 * sign-in in the browser does not carry over.
 */
export function setupInstallHint(target, options) {
    const strings = { ...DEFAULT_INSTALL_HINT_STRINGS, ...options.strings };
    const detected = detectInstallTarget(options.environment ?? readInstallEnvironment());
    let element = null;
    let disposed = false;
    const remove = () => {
        element?.remove();
        element = null;
    };
    const dispose = () => {
        disposed = true;
        subscribers.delete(render);
        remove();
    };
    function render() {
        remove();
        if (disposed || isDismissed(options.storageKey)) {
            return;
        }
        const prompt = detected === 'android' || detected === 'desktop' ? deferredPrompt : null;
        const stepsKey = STEPS_BY_TARGET[detected];
        const steps = prompt === null && stepsKey !== undefined ? strings[stepsKey] : [];
        if (prompt === null && steps.length === 0) {
            return;
        }
        const hint = document.createElement('aside');
        hint.className = 'pk-install-hint';
        hint.dataset.target = detected;
        hint.setAttribute('aria-label', strings.title);
        const title = document.createElement('strong');
        title.className = 'pk-install-hint-title';
        title.textContent = strings.title;
        const intro = document.createElement('p');
        intro.textContent = prompt === null ? strings.intro : strings.promptIntro;
        hint.append(title, intro);
        if (steps.length > 0) {
            const list = document.createElement('ol');
            list.className = 'pk-install-hint-steps';
            for (const step of steps) {
                const item = document.createElement('li');
                item.textContent = step;
                list.append(item);
            }
            hint.append(list);
        }
        if (options.signInRequired) {
            const note = document.createElement('p');
            note.className = 'pk-install-hint-note';
            note.textContent = strings.signInNote;
            hint.append(note);
        }
        const actions = document.createElement('div');
        actions.className = 'pk-install-hint-actions';
        if (prompt !== null) {
            const install = document.createElement('button');
            install.type = 'button';
            install.className = 'pk-install-hint-install';
            install.textContent = strings.install;
            install.addEventListener('click', async () => {
                install.disabled = true;
                deferredPrompt = null;
                await prompt.prompt();
                const choice = await prompt.userChoice;
                if (choice.outcome === 'accepted') {
                    dispose();
                }
                else {
                    render();
                }
            });
            actions.append(install);
        }
        const dismiss = document.createElement('button');
        dismiss.type = 'button';
        dismiss.className = 'pk-install-hint-dismiss';
        dismiss.textContent = strings.dismiss;
        dismiss.addEventListener('click', () => {
            rememberDismissal(options.storageKey);
            dispose();
        });
        actions.append(dismiss);
        hint.append(actions);
        element = hint;
        target.append(hint);
    }
    if (detected === 'standalone' || detected === 'unsupported' || isDismissed(options.storageKey)) {
        return { target: detected, dispose };
    }
    listenForPrompt();
    subscribers.add(render);
    render();
    return { target: detected, dispose };
}
