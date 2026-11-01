import { loadEnv, mergeConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
/** File names produced by `@vite-pwa/assets-generator` with the minimal-2023 preset. */
export const DEFAULT_ICONS = [
    { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
    { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
    { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
    { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
];
const DEFAULT_INCLUDE_ASSETS = ['favicon.ico', 'apple-touch-icon-180x180.png', 'logo.svg'];
/** `/my-app` -> `/my-app/`; empty -> `/`. */
export function normalizeBase(value) {
    if (!value || value === '/') {
        return '/';
    }
    const withLeading = value.startsWith('/') ? value : `/${value}`;
    return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}
/**
 * The complete Vite config of an app: base path from `VITE_BASE_PATH`,
 * manifest, service worker with a prompt-to-update flow, and
 * `__APP_VERSION__` from `VITE_APP_VERSION`.
 */
export function definePwaApp(app) {
    return ({ mode }) => {
        const env = loadEnv(mode, process.cwd(), '');
        const base = normalizeBase(env.VITE_BASE_PATH);
        const config = {
            base,
            define: {
                __APP_VERSION__: JSON.stringify(env.VITE_APP_VERSION || 'dev')
            },
            plugins: [
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
                        skipWaiting: false
                    }
                })
            ]
        };
        return app.vite ? mergeConfig(config, app.vite) : config;
    };
}
