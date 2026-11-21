import type { CatalogueItem } from '@business-software/shared';

// Made-up items, ids and codes.
export function catalogueItem(overrides: Partial<CatalogueItem> = {}): CatalogueItem {
  return {
    id: '00000000-0000-4000-8000-0000000000a1',
    archived: false,
    kind: 'goods',
    name: 'Tata Salt 1 kg',
    hindiName: 'टाटा नमक',
    code: 'SALT1',
    stockUnit: 'piece',
    sellingPrice: 2_800,
    wholesalePrice: null,
    mrp: 3_000,
    priceIncludesTax: true,
    gstRate: 500,
    hsn: '2501',
    version: 1,
    packs: [],
    barcodes: [{ code: '8901234567890', packId: null }],
    ...overrides,
  };
}
