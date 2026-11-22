# 0049 — WhatsApp in v1: click-to-chat links the owner sends; the Cloud API and outbox wait in the backlog

- **Date:** 2026-11-22
- **Status:** Accepted

## Context

ADR 0010 chose pg-boss, an outbox and the WhatsApp Cloud API for every WhatsApp message. On 2026-11-22 the owner moved the Cloud API task (P2.8) to the backlog as part of the portfolio cut (`docs/plans/2026-11-17-fast-track.md`, section 9): it needs a Meta developer account, an approved test number, a long-lived token and three templates per language, an outside dependency the remaining days can't absorb.

Three decided requirements still promise WhatsApp in features that stay in v1: udhaar reminders the owner sends with one click (`03` #15), customer statements "to print or send on WhatsApp" (`03` #14), and bills "shared as a PDF on WhatsApp" (`02` #16). They must keep working without the Cloud API.

## Options considered

### Option A — click-to-chat links (`https://wa.me/<number>?text=<message>`)
- Pros: no Meta account, no token, no templates, no cost. Opens WhatsApp Web or Desktop with the number and message filled in; the owner reviews and presses send, which matches "the owner approves" in `03` #15. Nothing new on the server: the link is built in the browser from data the screen already has.
- Cons: the app can't know whether the message was sent; the PDF can't be attached by the link, so it is downloaded and attached by hand; nothing can be sent automatically (the daily summary, the weekly reminder send).

### Option B — no WhatsApp in v1
- Pros: nothing to build.
- Cons: three decided features lose their sending step; the owner copies numbers by hand.

### Option C — build the Cloud API sender now (ADR 0010 as written)
- Pros: automatic sends, delivery status, the PDF attached.
- Cons: the outside approvals and P2.8's size are what the cut removes; the finish date moves by days.

## Decision

Option A, chosen by the owner on 2026-11-22 (`02` #27, `03` #16). A shared helper builds the link from an Indian mobile number (`91` + the 10 digits) and the message text in the bill language; the screens offer it as "Send on WhatsApp" next to the PDF download. ADR 0010 is unchanged and still describes the Cloud API path; it is built when P2.8 is brought back from the backlog.

## Why

It keeps every decided feature in v1 working with one owner click, costs nothing, needs no outside approval, and leaves ADR 0010's design intact for later. Nothing is sent without the owner seeing it, so there is no outbox to keep safe yet.

## Consequences

- No message is recorded as "sent": the entry log records that a reminder or statement was prepared, not delivered. When P2.8 arrives, the Cloud API path records delivery through the outbox (ADR 0010).
- The automatic daily summary (`07` #9–#10), quiet hours (`07` #11) and the weekly reminder send (`03` #15) wait for P2.8. Alerts stay in the app's bell.
- Message text must fit a URL: built with `encodeURIComponent`, kept short (a reminder, not a statement body), and never holding anything secret.
- Customers' phone numbers are already stored normalised (`normalizePhone`), so the link needs no new field.

## Interview note

"The proper WhatsApp integration needs Meta's approvals and an outbox, which I designed (ADR 0010) but scheduled after v1. For v1 I used WhatsApp's click-to-chat links: the app fills in the customer's number and message, and the owner presses send. Same user flow, zero outside dependencies, and the real integration can slot in later without changing the screens."
