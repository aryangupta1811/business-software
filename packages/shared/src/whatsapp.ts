// Click-to-chat links (ADR 0049, P1.15 design §7): the app fills in the customer's number and a
// short message; the owner presses send in WhatsApp. Nothing leaves the browser until then.

/**
 * `https://wa.me/91<number>?text=<message>` for a stored phone number (`normalizePhone`: ten
 * digits, not starting with 0). Refuses anything else with a RangeError, so a half-typed number
 * never opens a chat with a stranger. The link carries the number and the text, nothing more.
 */
export function whatsAppLink(phone: string, text: string): string {
  if (!/^[1-9]\d{9}$/.test(phone)) {
    throw new RangeError('A WhatsApp link needs a stored 10-digit mobile number');
  }
  return `https://wa.me/91${phone}?text=${encodeURIComponent(text)}`;
}
