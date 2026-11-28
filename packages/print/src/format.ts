// Numbers and dates on a bill: always Latin digits, whatever the bill language (`02` #17).
import { formatPaise, type Paise } from '@business-software/shared';

/** 2500 thousandths is "2.5"; 3000 is "3"; 250 is "0.25". */
export function formatQuantity(thousandths: number): string {
  const whole = Math.trunc(thousandths / 1000);
  const fraction = String(thousandths % 1000)
    .padStart(3, '0')
    .replace(/0+$/, '');
  return fraction === '' ? String(whole) : `${String(whole)}.${fraction}`;
}

/** 1200 basis points is "12%"; 250 is "2.5%"; 75 is "0.75%". */
export function formatRate(basisPoints: number): string {
  return `${String(Number((basisPoints / 100).toFixed(3)))}%`;
}

/** The same without the sign, for columns whose heading says it is money: "1,234.50". */
export function amount(paise: Paise): string {
  return formatPaise(paise).replace('₹', '');
}

/** "2026-11-23" is "23-11-2026". */
export function formatDate(businessDate: string): string {
  const [year, month, day] = businessDate.split('-');
  return `${day ?? ''}-${month ?? ''}-${year ?? ''}`;
}

const IST_MINUTES = 330;

/** An ISO moment as India's clock shows it: "23-11-2026" and "2:05 PM". India has no daylight saving. */
export function formatDateTime(iso: string): { date: string; time: string } {
  const shifted = new Date(new Date(iso).getTime() + IST_MINUTES * 60_000);
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const hours = shifted.getUTCHours();
  const minutes = String(shifted.getUTCMinutes()).padStart(2, '0');
  return {
    date: `${day}-${month}-${String(shifted.getUTCFullYear())}`,
    time: `${String(hours % 12 === 0 ? 12 : hours % 12)}:${minutes} ${hours < 12 ? 'AM' : 'PM'}`,
  };
}
