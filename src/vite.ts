import { loadEnv, mergeConfig, type Plugin, type UserConfig, type UserConfigFnObject } from 'vite';
import { VitePWA, type ManifestOptions } from 'vite-plugin-pwa';
import { PUSH_SW_FILE, pushServiceWorkerSource } from './sw-push.js';

type ManifestIcon = NonNullable<ManifestOptions['icons']>[number];

/** File names produced by `@vite-pwa/assets-generator` with the minimal-2023 preset. */
export const DEFAULT_ICONS: ManifestIcon[] = [
  { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
  { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
  { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
  { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
];

const DEFAULT_INCLUDE_ASSETS = ['favicon.ico', 'apple-touch-icon-180x180.png', 'logo.svg'];

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
export function normalizeBase(value: string | undefined): string {
  if (!value || value === '/') {
    return '/';
  }

  const withLeading = value.startsWith('/') ? value : `/${value}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

/** Emits the push and notification-click handlers that the service worker imports. */
export function pushServiceWorkerPlugin(): Plugin {
  return {
    name: 'pwa-kit:push-sw',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: PUSH_SW_FILE, source: pushServiceWorkerSource() });
    }
  };
}

/**
 * The complete Vite config of an app: base path from `VITE_BASE_PATH`,
 * manifest, service worker with a prompt-to-update flow and Web Push
 * handlers, and `__APP_VERSION__` from `VITE_APP_VERSION`.
 */
export function definePwaApp(app: PwaAppOptions): UserConfigFnObject {
  return ({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const base = normalizeBase(env.VITE_BASE_PATH);

    const config: UserConfig = {
      base,
      define: {
        __APP_VERSION__: JSON.stringify(env.VITE_APP_VERSION || 'dev')
      },
      plugins: [
        pushServiceWorkerPlugin(),
        VitePWA({
          registerType: 'prompt',
          includeAssets: app.includeAssets ?? DEFAULT_INCLUDE_ASSETS,
          manifest: {
            id: base,
            name: app.name,
            short_name: app.shortName ?? app.name,
            description: app.description,
            start_url: base,
            scope: base,
            display: 'standalone',
            orientation: 'portrait-primary',
            lang: app.lang,
            theme_color: app.themeColor,
            background_color: app.backgroundColor,
            icons: app.icons ?? DEFAULT_ICONS,
            ...app.manifest
          },
          // API responses are deliberately not cached here. The service worker
          // cache is keyed by URL, not by who is signed in, so it would serve one
          // user's data to the next and pass stale data off as fresh. The store's
          // localStorage cache covers offline use and is cleared on sign-out.
          workbox: {
            navigateFallback: 'index.html',
            cleanupOutdatedCaches: true,
            clientsClaim: true,
            skipWaiting: false,
            // `push` and `notificationclick` handlers; see sw-push.ts.
            importScripts: [PUSH_SW_FILE]
          }
        })
      ]
    };

    return app.vite ? mergeConfig(config, app.vite) : config;
  };
}
