import type { Paise } from '@business-software/shared';

/** 14150 → "141.50", 14100 → "141": the form `parseRupees` reads back. */
export function rupeesText(paise: Paise): string {
  const rupees = Math.floor(paise / 100);
  const rest = paise % 100;
  return rest === 0 ? String(rupees) : `${String(rupees)}.${String(rest).padStart(2, '0')}`;
}
