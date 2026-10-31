# 0025 — Design system: Apple-clean tokens, IBM Plex, light by default

- **Date:** 2026-10-31
- **Status:** Accepted

## Context

Every screen from P1.3 on needs the same look, so it's decided once. The owner's brief: clean, not "AI slop", **easy for shopkeepers to read (the number one priority)**, light colours with nothing flashy or neon, a professional dashboard "something like Apple's website", with light and dark mode. The app runs on a counter computer with keyboard and scanner, in English, Hindi and Hinglish (`product-overview.md`, ADR 0023). The CSP allows fonts, scripts and styles only from our own origin (ADR 0023). ADR 0003 already chose shadcn/ui on Radix with Tailwind.

The owner picked from browser mockups. Spec: `docs/plans/2026-10-31-p0.7-design-system-design.md`.

## Options considered

### Visual direction
- **A — Apple-clean** (cool white and greys, one blue accent, soft cards): the owner's brief almost word for word. **Chosen**, with corners sharpened from 14 px to **8 px** at the owner's request.
- **B — Warm paper** (off-white, deep green, hairline borders): calm and "ledger-like", but warmer than the brief.
- **C — Calm slate** (cool grey, indigo, compact): fits more rows, but reads as a developer tool.

### Font
- **IBM Plex Sans + IBM Plex Sans Devanagari:** one family designed for both scripts, so Hindi and English match; very clear digits for bills. **Chosen by the owner.**
- **Inter + Noto Sans Devanagari:** closest to Apple's SF Pro, but two unrelated designs and a very common look.
- **Mukta:** Indian-designed, one font for both scripts; warmer, less crisp numbers.

### Where tokens live
- **CSS variables in `styles.css`, mapped into Tailwind 4 with `@theme inline`; Tailwind's default palette and text sizes removed.** **Chosen:** one place, light and dark switch by redefining variables, and only tokens can be used.
- A TypeScript token file that generates the CSS: an extra build step for no gain at this size.

### Default mode
- **Light, with a sun/moon button, remembered per computer.** **Chosen by the owner:** shops are bright and the brief says light.
- Follow the operating system's setting: most counter PCs never change it, and it can surprise.
- A setting only in Settings: harder to find.

### Getting shadcn/ui components
- **Copy the source by hand from the shadcn registry, then restyle.** **Chosen.**
- The shadcn CLI (`components.json`, `@/` alias): `init` and `add` rewrite `styles.css` with shadcn's own colour variables, which would fight our tokens.

## Decision

Apple-clean tokens (`#f5f5f7` page, white cards, `#1d1d1f` text, `#0071e3` buttons, `#0066cc` link/focus blue; dark mode on black with `#1c1c1e` cards), 8 px corners, a 4 px spacing grid, 40 px controls, text from 13 to 28 px with a 15 px body, IBM Plex self-hosted (weights 400/500/600, Latin and Devanagari subsets), Lucide icons, light by default with `public/theme-init.js` applying a saved dark theme before the first paint. A test enforces readability: text ≥ 4.5:1 (main text ≥ 7:1), input edges and focus ring ≥ 3:1, in both modes.

## Why

- **Readability is checked, not hoped for.** `src/theme/contrast.test.ts` reads the tokens and fails on any pair below WCAG AA. It caught two colours from the approved table on its first run: blue link text on the grey page (4.31:1), changed to Apple's own link blue `#0066cc`, and green on its badge (4.48:1).
- **Self-hosting is forced by the CSP** (`font-src 'self'`), and is faster and private anyway.
- **No white flash** for dark-mode users: the class is set by a tiny external script before React loads. Inline scripts are blocked by `script-src 'self'`, so it's a file.
- **Hindi gets room:** line height 1.6 under `html[lang='hi']` (not `:lang(hi)`, which also matches Hinglish's `hi-Latn`).

## Consequences

- No Tailwind colour like `stone-500` or size like `text-sm` exists any more: new code must use tokens (`bg-surface`, `text-muted`, `text-body`). Dynamic class names (`bg-${name}`) don't work; Tailwind needs whole names in the source.
- Fonts add ~307 KB (woff2) on the first visit, then are cached for a year.
- The production CSS minifier shortens hex (`#fff`), so code that reads token values at runtime must accept short hex (found on `/design`, fixed with a test).
- `/design` shows every token and component in both modes and three languages; it's in the live app, not in the sidebar.
- A per-person theme waits for logins (P1.4).

## Interview note

I designed the UI from constraints first: a keyboard billing counter, Hindi beside English, and a strict CSP that forced self-hosted fonts and an external theme script. The owner picked the look from mockups, and I turned "easy to read" into an automated WCAG contrast test, which immediately caught two failing colours in the approved palette. Tokens live as CSS variables mapped into Tailwind, with the default palette removed so nobody can bypass them.
