import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// `npm run icons` turns public/logo.svg into every icon the manifest and iOS need.
export default defineConfig({
  preset: minimal2023Preset,
  images: ['public/logo.svg']
});
