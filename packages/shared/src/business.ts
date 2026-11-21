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

/**
 * What each business type switches on at signup (#1). The owner can change any later (#3).
 * Each list is in `FEATURES` order, the order settings saves in, so a first save of the same
 * features isn't logged as a change.
 */
export const FEATURE_PRESETS: Record<BusinessType, readonly Feature[]> = {
  kirana: ['loose_weight', 'expiry_dates', 'udhaar_prominent'],
  medical: ['expiry_dates', 'batches', 'mrp', 'expiry_alerts'],
  clothing: ['variants', 'exchanges', 'barcode_labels'],
  electronics: ['serial_numbers', 'warranty', 'service_items'],
  hardware: ['multiple_units', 'wholesale_price', 'large_credit'],
};

/** #6: not registered → plain bill; regular → tax invoice; composition → bill of supply. */
export const GST_STATUSES = ['unregistered', 'regular', 'composition'] as const;
export type GstStatus = (typeof GST_STATUSES)[number];

/**
 * Every permission a route can require (ADR 0036). The owner has all of them; a staff login
 * holds `session.own` plus the switches the owner gave it (`STAFF_SWITCHES` in staff.ts).
 */
export const PERMISSIONS = [
  'session.own', // anyone logged in: their own session (lock, log out)
  'settings.view',
  'settings.manage',
  // P1.5: the Staff page and its routes. Owner only: no staff switch grants it.
  'staff.manage',
  // P1.7: list and look items up; change them; see and change the purchase price (`01` #1).
  'items.view',
  'items.manage',
  'items.view_cost',
  // P1.8: see stock and its history; opening stock and adjustments (`01` #11).
  'stock.view',
  'stock.adjust',
  // P1.13: the billing page, its catalogue copy and held bills (`02`).
  'billing.sell',
  // P1.13: discounts up to the person's limit (`02` #12); the owner sets each staff login's limit.
  'billing.discount',
  // P1.13: find customers at the counter; add and edit them (`02` #2, #7).
  'customers.view',
  'customers.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];
