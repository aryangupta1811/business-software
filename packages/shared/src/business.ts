// Business types, their feature presets, GST statuses and permission names (Module 00 #1–6,
// #17). Shared by the API, the database checks and the screens.

export const BUSINESS_TYPES = ['kirana', 'medical', 'clothing', 'electronics', 'hardware'] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

/** Every feature a business can switch on or off (Module 00's preset table). */
export const FEATURES = [
  'loose_weight',
  'expiry_dates',
  'udhaar_prominent',
  'batches',
  'mrp',
  'expiry_alerts',
  'variants',
  'exchanges',
  'barcode_labels',
  'serial_numbers',
  'warranty',
  'service_items',
  'multiple_units',
  'wholesale_price',
  'large_credit',
] as const;
export type Feature = (typeof FEATURES)[number];

/** What each business type switches on at signup (#1). The owner can change any later (#3). */
export const FEATURE_PRESETS: Record<BusinessType, readonly Feature[]> = {
  kirana: ['loose_weight', 'expiry_dates', 'udhaar_prominent'],
  medical: ['batches', 'expiry_dates', 'mrp', 'expiry_alerts'],
  clothing: ['variants', 'exchanges', 'barcode_labels'],
  electronics: ['serial_numbers', 'warranty', 'service_items'],
  hardware: ['multiple_units', 'wholesale_price', 'large_credit'],
};

/** #6: not registered → plain bill; regular → tax invoice; composition → bill of supply. */
export const GST_STATUSES = ['unregistered', 'regular', 'composition'] as const;
export type GstStatus = (typeof GST_STATUSES)[number];

/**
 * Every permission a route can require (ADR 0036). The owner has all of them; P1.5 lets the
 * owner give staff logins a subset.
 */
export const PERMISSIONS = ['settings.view', 'settings.manage'] as const;
export type Permission = (typeof PERMISSIONS)[number];
