/**
 * Install hint: tells the user how to add the app to their home screen, in
 * the words of the browser they are using. iOS has no install prompt, so it
 * gets instructions; Chromium gets a real Install button.
 */
/** Where the user is, as far as installing goes. */
export type InstallTarget = 
/** Already running as an installed app. */
'standalone'
/** Safari on iOS 26 and later: Share sits in the ⋯ menu. */
 | 'ios-safari'
/** Safari before iOS 26: Share sits in the toolbar. */
 | 'ios-safari-legacy' | 'ipad-safari'
/** Chrome on iOS 16.4+: Share sits in the address bar. */
 | 'ios-chrome'
/** Edge, Firefox and other browsers on iOS 16.4+: Share sits in the browser menu. */
 | 'ios-browser'
/** Non-Safari browsers before iOS 16.4 cannot add to the Home Screen. */
 | 'ios-open-in-safari'
/** Facebook, Messenger, Instagram, WhatsApp, the Google app… on iOS. */
 | 'ios-in-app' | 'android-in-app' | 'android'
/** Safari 17+ on macOS: File → Add to Dock. */
 | 'mac-safari'
/** Chromium on the desktop: only the Install button, once the browser offers it. */
 | 'desktop' | 'unsupported';
export type InstallEnvironment = {
    userAgent: string;
    /** iPadOS reports a Mac user agent; touch points give it away. */
    maxTouchPoints: number;
    standalone: boolean;
};
export type InstallHintStrings = {
    title: string;
    /** Shown above the steps. */
    intro: string;
    /** Shown above the Install button where the browser can install directly. */
    promptIntro: string;
    /** With `signInRequired`: the installed app does not share the browser's sign-in. */
    signInNote: string;
    install: string;
    dismiss: string;
    iosSafari: readonly string[];
    iosSafariLegacy: readonly string[];
    ipadSafari: readonly string[];
    iosChrome: readonly string[];
    iosBrowser: readonly string[];
    iosOpenInSafari: readonly string[];
    iosInApp: readonly string[];
    androidInApp: readonly string[];
    android: readonly string[];
    macSafari: readonly string[];
};
export declare const DEFAULT_INSTALL_HINT_STRINGS: InstallHintStrings;
export declare function readInstallEnvironment(): InstallEnvironment;
/** Works out which instructions fit this browser. Pure, so apps can test their own copy. */
export declare function detectInstallTarget(env: InstallEnvironment): InstallTarget;
export type InstallHintOptions = {
    /**
     * localStorage key remembering a dismissal. Apps share one GitHub Pages
     * origin, so make it app-specific, e.g. `notes:install-hint-dismissed`.
     */
    storageKey: string;
    strings?: Partial<InstallHintStrings>;
    /** Adds `signInNote`: an installed iOS app starts signed out. */
    signInRequired?: boolean;
    /** Defaults to the current browser; tests pass their own. */
    environment?: InstallEnvironment;
};
export type InstallHint = {
    /** What was detected. */
    target: InstallTarget;
    /** Removes the hint and stops listening. */
    dispose(): void;
};
/**
 * Appends an install hint to `target`, tailored to the browser. Renders
 * nothing when the app already runs installed or the user dismissed it. Show
 * it on the sign-in screen: an installed iOS app has its own storage, so a
 * sign-in in the browser does not carry over.
 */
export declare function setupInstallHint(target: HTMLElement, options: InstallHintOptions): InstallHint;
