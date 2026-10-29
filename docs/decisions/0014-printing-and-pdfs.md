# 0014 — Printing and PDFs: browser print stylesheets, kiosk printing, headless Chromium

- **Date:** 2026-10-29
- **Status:** Accepted

## Context

Open question 5 in `product-overview.md`: thermal receipt printer (58/80 mm), A4 invoices, or both? Module 02 drafts include printing and sharing bills on WhatsApp. Bills may print in Hindi (Module 00 #25, decided in Module 02). Billing must take seconds (NFR 5). The shop uses a Windows counter computer with Chrome.

## Options considered

### Printing
- **A — Browser printing with print stylesheets (chosen):** nothing to install; one HTML template for screen, receipt and A4.
- **B — A local print agent sending raw ESC/POS commands (e.g. QZ Tray or our own helper):** fastest thermal printing and can open the cash drawer, but needs an install on every counter, and QZ Tray's no-prompt mode needs a paid certificate.
- **C — A desktop app (Electron / Tauri):** full printer control, but a second app to build, sign and update.

### PDFs
- **A — Headless Chromium (Playwright) rendering the same HTML (chosen):** pixel-identical to the printout; shapes Hindi (Devanagari) text correctly.
- **B — JavaScript PDF libraries (pdfkit, jsPDF, react-pdf):** lighter, but many don't do complex text shaping, so Hindi conjuncts (क्ष, त्र) come out broken, and the layout must be built a second time.

## Decision

- **Both formats:** 80 mm thermal receipt (default), 58 mm as a setting, and A4 tax invoice. A4 is used for B2B bills and sharing.
- Print from the browser using print stylesheets per paper size.
- Counter computers run Chrome with the `--kiosk-printing` flag, so a bill prints to the default printer with one key and no dialog. A short setup guide covers this and printer margins.
- PDFs (for WhatsApp and download) are rendered from the same HTML by headless Chromium in the `worker` (ADR 0010).
- Raw ESC/POS printing (cash drawer, faster receipts) is only added later if a real need appears.

## Why

Browser printing needs no install and reuses one template everywhere. Chromium is the reliable way to get correct Hindi in PDFs.

## Consequences

- Output depends on the printer driver (paper width, margins), so the setup guide and a test-print page matter.
- The worker image carries Chromium, making it bigger and needing more memory. Watch the EC2 server's memory (ADR 0011).
- Barcode label printing (clothing, loose items: Module 01 #8) is designed when that feature is built.

## Interview note

I print from the browser with separate print stylesheets for 80 mm, 58 mm and A4, and set the counter's Chrome to kiosk printing so a bill prints with one key and no dialog. For PDFs I render the same HTML with headless Chromium, because many PDF libraries don't shape Devanagari and print broken Hindi. One template for screen, paper and PDF means they can never disagree.
