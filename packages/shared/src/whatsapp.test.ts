import { describe, expect, it } from 'vitest';
import { whatsAppLink } from './whatsapp.js';

describe('whatsAppLink', () => {
  it('builds a click-to-chat link with 91 and the ten digits', () => {
    expect(whatsAppLink('9876543210', 'Hello')).toBe('https://wa.me/919876543210?text=Hello');
  });

  it('encodes the rupee sign, &, #, spaces and line breaks', () => {
    const link = whatsAppLink('9876543210', 'Shop & Co #1: ₹1,234.50\nThanks');
    expect(link).toBe(
      'https://wa.me/919876543210?text=Shop%20%26%20Co%20%231%3A%20%E2%82%B91%2C234.50%0AThanks',
    );
    // Decoding gives the message back exactly: nothing a person typed can end the text early.
    expect(decodeURIComponent(link.split('?text=')[1] ?? '')).toBe(
      'Shop & Co #1: ₹1,234.50\nThanks',
    );
  });

  it('encodes Hindi', () => {
    const text = 'आपका बिल ₹100 का है';
    const link = whatsAppLink('9876543210', text);
    expect(link).not.toMatch(/[^\x20-\x7e]/);
    expect(decodeURIComponent(link.split('?text=')[1] ?? '')).toBe(text);
  });

  it('carries nothing but the number and the text', () => {
    const link = whatsAppLink('9876543210', 'x');
    expect(link).toBe('https://wa.me/919876543210?text=x');
    expect(link.split('?')).toHaveLength(2);
  });

  it.each(['', '98765', '98765432101', '0123456789', '+919876543210', '98765 43210', 'abcdefghij'])(
    'refuses %j: only a stored 10-digit number is used',
    (phone) => {
      expect(() => whatsAppLink(phone, 'Hello')).toThrow(RangeError);
    },
  );
});
