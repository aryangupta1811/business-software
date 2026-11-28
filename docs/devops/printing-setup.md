# Printing setup (counter computer)

Bills print from the browser: the app draws the bill in a hidden frame and calls `print()`. Chrome's `--kiosk-printing` switch makes that go straight to the default printer, with no dialog (ADR 0014). Set it up once on each counter computer. The same steps are in the app, in Settings, Printing.

## Steps (Windows)

1. Make the receipt printer the Windows **default printer** (Settings, Bluetooth & devices, Printers & scanners).
2. In the printer's preferences, set the **paper size** to 80 mm (or 58 mm) and the **margins to none**. The bill's own stylesheet sets no margin for receipts, so the printer driver's paper and margins decide the result.
3. Right-click the Chrome shortcut you open the app with, choose **Properties**, and at the end of **Target** add a space and `--kiosk-printing`. Close every Chrome window, then open Chrome from that shortcut. (A Chrome that was already running ignores the switch.)
4. In the app: Settings, Printing, **Test 80 mm receipt**. It should come out with no dialog.
5. Still in Settings, under Computers, set this computer's **receipt paper** and whether a saved bill **prints at once** (on by default).

## Keys

| Key | Where | What |
| --- | --- | --- |
| `Alt+P` | "Bill saved" panel, Bills page | Print the receipt. The second print of a bill says **Reprint** with its date and goes in the entry log. |
| `Alt+A` | the same | Print the A4 invoice. (Inside the payment panel the same key splits the payment: that panel's keys work only while it is open.) |
| `Alt+W` | the same | Send on WhatsApp: opens a chat with the customer's number and a short message. The owner presses send there. |
| `Alt+V` | anywhere | Open the Bills page. |

A bill whose buyer has a GSTIN prints on A4 by default, even at a receipt counter (`Alt+P` still gives the receipt).

## Limits to know

- With `--kiosk-printing`, **every** print goes to the default printer, an A4 invoice included. A counter that prints A4 invoices should open the app from a second Chrome shortcut without the switch, so Chrome asks which printer.
- Hindi item names and labels print in IBM Plex Sans Devanagari, shipped with the app (no font is fetched from the internet).
- The PDF (Download PDF, and the PDF in the WhatsApp message) arrives with PR 2 of P1.15.
