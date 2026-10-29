# 0003 — Frontend: React + Vite single-page app

- **Date:** 2026-10-29
- **Status:** Accepted

## Context

The app runs in Chrome on a shop's counter computer, behind a login. Billing must be fast with keyboard and barcode scanner alone (`product-overview.md`). English and Hindi throughout (NFR 7). The quality bar says the UI must look designed, not like a template (`CLAUDE.md` rule 8). No phone use (Module 00 #23).

## Options considered

### Option A — React + Vite single-page app (SPA)
- Pros: the app loads once, then only data moves, which is fast for all-day counter use; served as static files from a CDN (cheap, nothing to run); simplest mental model.
- Cons: the first load downloads the whole app (fine on a counter PC, cached afterwards); no server rendering for public pages.

### Option B — Next.js (React with server rendering)
- Pros: good for public, SEO-heavy sites; popular.
- Cons: a server to run and pay for; server/client component split adds complexity; none of its strengths matter for a logged-in counter app.

### Option C — Angular or Vue
- Pros: both capable; Angular is opinionated and complete.
- Cons: smaller ecosystem for the component and form libraries we want; React has the most job demand.

## Decision

Option A, with:

| Need | Library | Why |
| --- | --- | --- |
| Routing | TanStack Router | Type-safe routes and URL parameters |
| Server data | TanStack Query | Caching, retries, loading and error states |
| Forms | React Hook Form + Zod | Same Zod schemas as the server (`packages/shared`) |
| Components | shadcn/ui on Radix, styled with Tailwind CSS | We own the component code and restyle it fully, and Radix provides accessibility and keyboard behaviour |
| Languages | i18next | English and Hindi, switchable per user |

The design is keyboard-first: every action on the billing screen has a shortcut. Barcode scanners act as keyboards, so they need no special driver.

## Why

- A logged-in tool has no SEO need, so server rendering would add cost and complexity for nothing.
- shadcn/ui copies component source into the repo instead of hiding it in a package, so the app can have its own visual design rather than a stock look.

## Consequences

- Design tokens (colours, type scale, spacing, a font that covers both Latin and Devanagari) are set up before the first real screen, so screens don't drift.
- A public marketing page, if ever needed, can be a separate static site.
- Hindi text is longer than English in places, so layouts must be tested in both languages.

## Interview note

I picked a single-page app because the users are logged-in shop staff on a desktop: there's no SEO to gain from server rendering, and an SPA is just static files on a CDN. I chose shadcn/ui so I own the component code and could give the product its own design while keeping Radix's accessibility. Forms use the same Zod schemas as the server, so validation can't disagree between screen and API.
