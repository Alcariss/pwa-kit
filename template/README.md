# Notes

Built on [pwa-kit](https://github.com/Alcariss/pwa-kit): an installable PWA on
GitHub Pages, with data in Grist behind the pwa-kit worker and sign-in with
Google or GitHub.

```bash
cp .env.example .env   # set VITE_API_URL_PRIMARY
npm install
npm run dev            # http://localhost:5173
npm test
npm run icons          # after changing public/logo.svg
```

Deploys on every push to `main` through the shared workflow. It needs Pages set
to *GitHub Actions* and the repository secret `VITE_API_URL_PRIMARY`.

Update the kit with `npm update @alcariss/pwa-kit` (stays within the major
version in `package.json`).
