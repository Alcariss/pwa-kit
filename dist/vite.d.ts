import { type UserConfig, type UserConfigFnObject } from 'vite';
import { type ManifestOptions } from 'vite-plugin-pwa';
type ManifestIcon = NonNullable<ManifestOptions['icons']>[number];
/** File names produced by `@vite-pwa/assets-generator` with the minimal-2023 preset. */
export declare const DEFAULT_ICONS: ManifestIcon[];
export type PwaAppOptions = {
    name: string;
    shortName?: string;
    description: string;
    /** BCP 47 language tag, e.g. `cs-CZ`. */
    lang: string;
    themeColor: string;
    backgroundColor: string;
    icons?: ManifestIcon[];
    includeAssets?: string[];
    /** Extra manifest fields, merged over the defaults. */
    manifest?: Partial<ManifestOptions>;
    /** Extra Vite config, merged over the defaults. */
    vite?: UserConfig;
};
/** `/my-app` -> `/my-app/`; empty -> `/`. */
export declare function normalizeBase(value: string | undefined): string;
/**
 * The complete Vite config of an app: base path from `VITE_BASE_PATH`,
 * manifest, service worker with a prompt-to-update flow, and
 * `__APP_VERSION__` from `VITE_APP_VERSION`.
 */
export declare function definePwaApp(app: PwaAppOptions): UserConfigFnObject;
export {};
