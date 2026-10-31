# 0023 — Web app build, serving and languages: Caddy in Compose, strict caching and CSP, file-based routes, three languages

- **Date:** 2026-10-30
- **Status:** Accepted

## Context

P0.5 creates `apps/web`, the React single-page app chosen in ADR 0003. Several choices were still open:
- how it runs in Docker Compose, given that on the server Caddy serves the files and passes `/api` to the API (ADR 0011);
- how the browser caches the files;
- how routes are written;
- how languages work. On 2026-10-30 the owner added **Hinglish** (Hindi in English letters) next to English and Hindi (Module 00 #25, NFR 7).

The repo is public and anything shipped to the browser is readable, so the browser must never get a secret (`docs/devops/secrets.md`, rule 3).

## Options considered

### Serving the built app in Compose
- **Caddy container (chosen):**
  - Pros: the same server and the same `/api` routing as production, so one web server to learn and the local setup rehearses the real one.
  - Cons: one more image to build.
- **nginx:**
  - Pros: the most common choice, widely known.
  - Cons: a second web server to learn, since production uses Caddy for its automatic HTTPS.
- **`vite preview`:**
  - Pros: nothing extra to set up.
  - Cons: Vite's docs say it isn't a production server, and it doesn't rehearse the real setup.

### Caching
- **Hashed files cached forever, `index.html` never (chosen):** Vite names files after their content (`index-B2VE6WIS.js`), so a changed file always has a new name.
- **Short cache on everything:** simpler, but every page load re-checks every file, and a cache on `index.html` can still hold an old deploy.

### Routes
- **File-based, with the generated `routeTree.gen.ts` committed (chosen):**
  - Pros: TanStack's recommended setup; each page becomes its own download automatically.
  - Cons: a generated file in git (excluded from lint and Prettier).
- **Code-based:** Pros: no generated file. Cons: hand wiring for every screen, and code splitting by hand.

### How Hinglish is identified
- **`hi-Latn` (chosen):** the BCP 47 tag for "Hindi in Latin script", so browsers and screen readers understand `<html lang="hi-Latn">`.
- **A made-up code like `hinglish`:** Cons: means nothing to the browser.

### Where the language choice is kept
- **The browser's `localStorage`, until logins exist (chosen):** P1.4 moves it to the user's profile.
- **The browser's language setting:** Cons: most counter PCs are set to English whatever the shopkeeper reads best.

### Test environment for components
- **jsdom (chosen):** closest to a real browser for Testing Library.
- **happy-dom:** faster, but less faithful.

## Decision

1. **`web` service in Compose:** a two-stage image (`apps/web/Dockerfile`).
   - `node:24-slim` builds the files.
   - `caddy:2.11-alpine` serves them as a non-root user, on `127.0.0.1:8080`.
   - Caddy passes `/api/*` to `api:3000`.
   - No `depends_on`: if the API is down, the page still loads and says so.
2. **Caddy rules (`apps/web/Caddyfile`):**
   - `/assets/*`: `Cache-Control: public, max-age=31536000, immutable`, and a missing file is a 404;
   - every other path: `index.html` with `no-cache` (the SPA fallback);
   - a strict Content-Security-Policy (`default-src 'self'`, no inline scripts, `frame-ancestors 'none'`), plus `nosniff`, a referrer policy and no `Server` header;
   - errors (a missing asset, the API down) are answered by `handle_errors`. It sets the security headers again, because Caddy's error path drops headers set earlier, and adds `Cache-Control: no-store`. Found when the first container check showed a 404 with `immutable` and `Server: Caddy`;
   - admin API off, nothing written to disk.
3. **Development:** Vite on `127.0.0.1:5173` proxies `/api` to `127.0.0.1:3000`, so the browser sees one origin there too. `pnpm dev` runs the API and the web app together. Dev mode has no CSP, because Vite injects inline scripts.
4. **No `VITE_` variables.** The app only ever calls the relative path `/api`, so it needs no configuration.
5. **Routes:** TanStack Router, file-based (`src/routes/`) with `autoCodeSplitting`. `routeTree.gen.ts` is committed, so lint and type-checks need no build.
6. **Languages:** i18next with bundled `en`, `hi` and `hi-Latn` files.
   - Keys are type-checked against `en.json`.
   - A test fails if any file is missing a key, if Hindi isn't in Devanagari, or if Hinglish contains Devanagari.
   - `fallbackLng: 'en'` with `load: 'currentOnly'`: without it, i18next falls back from `hi-Latn` to `hi`. A test proves it.
   - The choice is saved in `localStorage` (blocked storage means English), and `<html lang>` follows it.
   - Language names are shown in their own script: English, हिन्दी, Hinglish.
7. **Tests:** Vitest with jsdom and Testing Library. Playwright arrives with the first real flow (P1.3).

## Why

- Running the real web server locally means the `/api` routing, the fallback and the headers are tested long before the cloud exists (stage 5).
- The caching rules give instant loads and still pick up a new deploy on the next load. They also handle a trap: if a missing chunk fell back to `index.html`, an old tab would cache HTML under a script's name for a year.
- A CSP costs nothing while the app loads only its own files. Adding one later means hunting down everything that breaks it.
- Hinglish speakers chose Latin letters on purpose, so showing them Devanagari as a fallback would be a bug, not a fallback.

## Consequences

- Anything from another origin, such as a font CDN or an analytics script, must be added to the CSP on purpose. P0.7 should self-host fonts.
- On the server (stage 5), the Caddyfile's site address becomes the real domain, which turns on automatic HTTPS. The rest stays the same.
- Every new string needs all three files, and the tests enforce it. Layouts must be checked in all three languages: Hindi is often longer.
- `routeTree.gen.ts` changes whenever a route is added; commit it with the route.
- Module 09's voice input will need `microphone` allowed if a Permissions-Policy header is ever added.

## Interview note

The web app is static files served by Caddy, the same server as in production. Caddy also proxies `/api`, so the browser sees one origin and needs no configuration and no secrets. Hashed assets are cached forever and `index.html` never, so deploys show up immediately, and a strict CSP blocks injected scripts. For languages, I support English, Hindi and Hinglish with i18next. Tests check all three files have the same keys and the right script, and I found and pinned an i18next default that would have shown Hinglish users Devanagari.
