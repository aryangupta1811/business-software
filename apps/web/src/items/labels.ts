import type { BuiltInUnit } from '@business-software/shared';
import type { TFunction } from 'i18next';

/** A built-in unit's name in the chosen language; owners type their own units' names. */
export const unitName = (t: TFunction, unit: BuiltInUnit): string => t(`units.${unit}`);

/** 1800 basis points → "18%", 25 → "0.25%". For showing only; the rate stays an integer. */
export const gstRateText = (basisPoints: number | null): string =>
  basisPoints === null ? '' : `${String(basisPoints / 100)}%`;
