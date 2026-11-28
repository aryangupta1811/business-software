import { describe, expect, it } from 'vitest';
import { amountInWords } from './words.js';

describe('amountInWords in English', () => {
  it.each([
    [0, 'Rupees Zero Only'],
    [50, 'Fifty Paise Only'],
    [1, 'One Paisa Only'],
    [100, 'Rupees One Only'],
    [101, 'Rupees One and One Paisa Only'],
    [1_900, 'Rupees Nineteen Only'],
    [2_000, 'Rupees Twenty Only'],
    [10_000, 'Rupees One Hundred Only'],
    [100_000, 'Rupees One Thousand Only'],
    [10_000_000, 'Rupees One Lakh Only'],
    [
      123_456_789,
      'Rupees Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven and Eighty Nine Paise Only',
    ],
    [1_000_000_000, 'Rupees One Crore Only'],
    [2_500_000_000, 'Rupees Two Crore Fifty Lakh Only'],
    [100_000_000_000, 'Rupees One Hundred Crore Only'],
    [100_100_000_000, 'Rupees One Hundred Crore Ten Lakh Only'],
    [10_500, 'Rupees One Hundred Five Only'],
  ])('%i paise is %s', (paise, words) => {
    expect(amountInWords(paise, 'en')).toBe(words);
  });

  it('uses the same English words for Hinglish', () => {
    expect(amountInWords(10_000_000, 'hi-Latn')).toBe(amountInWords(10_000_000, 'en'));
  });
});

describe('amountInWords in Hindi', () => {
  it.each([
    [0, 'शून्य रुपये मात्र'],
    [50, 'पचास पैसे मात्र'],
    [1, 'एक पैसा मात्र'],
    [100, 'एक रुपया मात्र'],
    [101, 'एक रुपया और एक पैसा मात्र'],
    [10_000, 'एक सौ रुपये मात्र'],
    [100_000, 'एक हज़ार रुपये मात्र'],
    [10_000_000, 'एक लाख रुपये मात्र'],
    [123_456_789, 'बारह लाख चौंतीस हज़ार पाँच सौ सड़सठ रुपये और नवासी पैसे मात्र'],
    [1_000_000_000, 'एक करोड़ रुपये मात्र'],
    [100_000_000_000, 'एक सौ करोड़ रुपये मात्र'],
  ])('%i paise is %s', (paise, words) => {
    expect(amountInWords(paise, 'hi')).toBe(words);
  });

  it('names every number from 1 to 99 distinctly, in Devanagari only', () => {
    const names = Array.from({ length: 99 }, (_, i) =>
      amountInWords((i + 1) * 100, 'hi').replace(/ रुपया? मात्र$/, ''),
    );
    expect(new Set(names).size).toBe(99);
    for (const name of names) expect(name).toMatch(/^[\p{Script=Devanagari}\u200d ]+$/u);
  });
});

describe('amountInWords refuses what is not an amount', () => {
  it.each([-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('%s', (paise) => {
    expect(() => amountInWords(paise, 'en')).toThrow(RangeError);
  });
});
