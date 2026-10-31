# 0026 — Keyboard shortcuts: our own small module; native `<dialog>` for modals

- **Date:** 2026-10-31
- **Status:** Accepted

## Context

Billing must be fast with keyboard and scanner alone (`product-overview.md`). A barcode scanner types into the focused field like a keyboard, so shortcuts must not fire while someone types, yet billing's F-keys must work while the cursor stays in the search box. Staff may switch Windows to a Hindi keyboard layout, where the H key types "ह". The CSP's `style-src 'self'` blocks `<style>` elements added at runtime. P0.7 needs a shortcut system and a help panel (`?`) listing the shortcuts that work on the current screen.

## Options considered

### Shortcut handling
- **Our own module (~150 lines with tests):** a registry, a provider listening on `window`, and a `useShortcut` hook. **Chosen.**
- **react-hotkeys-hook:** popular and has scopes, but its in-field rules are per-hotkey flags and it matches the typed character, so `Alt+H` on a Hindi layout and "F-keys yes, letters no inside fields" need wrapping; the help list would be ours anyway.
- **tinykeys:** tiny, but no registry to list active shortcuts.

### Modal dialogs (the help panel, and later ones)
- **The browser's `<dialog>` with `showModal()`:** focus moves in and returns, `Esc` closes, the page behind is inert, the `::backdrop` is styled in CSS. **Chosen.**
- **shadcn/Radix Dialog:** its scroll lock (`react-remove-scroll`) inserts a `<style>` element, which the CSP blocks.
- Radix Dialog plus `'unsafe-inline'` in `style-src`: weakens the CSP for every page to save little work.

## Decision

Shortcuts are registered by components while mounted (`useShortcut({ keys, description, group, action })`) and listed by `?`. Rules, each with a test:
1. In text fields, only F1–F12, `Esc` and `Ctrl`/`Alt` combos fire.
2. Letters and digits match the physical key (`event.code`), so `Alt+H` works on any layout.
3. The browser's keys (`F5`, `F11`, `F12`, `Ctrl+T/W/N/R/L`) and plain letters are refused at registration.
4. Registering keys already in use throws.
5. Modifiers match exactly (`Ctrl+Alt` / AltGr is not `Alt`); auto-repeat and IME composition never fire; nothing fires while the help panel is open.

Modals use the native `<dialog>`.

## Why

- The rules above are what a scanner-driven counter needs, and they're short enough to own and test fully.
- The native dialog keeps the CSP strict with no extra library.

## Consequences

- New shortcuts go through `useShortcut`; a clash shows up as an error in development and tests.
- jsdom lacks `showModal`/`close`; `src/test/setup.ts` polyfills them.
- Hooks live in their own files (`use-shortcut.ts`, `context.ts`) because React's fast-refresh lint rule forbids hooks and components in one file.
- Later modals (P1.x) follow the same `<dialog>` pattern rather than Radix Dialog.

## Interview note

The keyboard system is built for a barcode scanner: scanners type into the focused field, so letter shortcuts are off inside inputs but F-keys still work, and letters match the physical key so a Hindi layout doesn't break them. I wrote a small registry instead of a library because no library gave me those rules plus a live list for the help panel. For the help panel I used the native `<dialog>`, because Radix's dialog injects a style tag that my CSP blocks.
