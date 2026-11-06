import { type AuthProvider, type Diagnostics } from './contract.js';
/** Escapes text for interpolation into `innerHTML`, including attribute values. */
export declare function escapeHtml(value: unknown): string;
export declare function requiredElement<T extends Element = HTMLElement>(selector: string, root?: ParentNode): T;
/** "just now", "5 minutes ago", "3 hours ago", in the given locale. */
export declare function formatAge(ageMs: number, locale?: string): string;
/** Renders the `?debug=1` panel. Pass null to empty it. */
export declare function renderDiagnostics(target: HTMLElement, diagnostics: Diagnostics | null, extra?: Readonly<Record<string, string>>): void;
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
export declare function setupUpdatePrompt(registerSW: RegisterSW, options?: UpdatePromptOptions): void;
export declare const DEFAULT_PROVIDER_LABELS: Record<AuthProvider, string>;
export declare const DEFAULT_AUTH_ERROR_MESSAGES: Record<string, string>;
export type LoginScreenOptions = {
    title: string;
    providers: readonly AuthProvider[];
    onSelect(provider: AuthProvider): void;
    /** Shown above the buttons, e.g. why the previous attempt failed. */
    message?: string | null;
    labels?: Partial<Record<AuthProvider, string>>;
};
export declare function renderLoginScreen(target: HTMLElement, options: LoginScreenOptions): void;
export {};
