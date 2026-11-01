/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** Short commit SHA of the deployed build, `dev` locally. */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_API_URL_PRIMARY: string;
  readonly VITE_AUTH_PROVIDERS?: string;
}
