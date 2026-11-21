import type { CatalogueView } from '@business-software/shared';
import { describe, expect, test } from 'vitest';
import { catalogueItem } from '../test/catalogue';
import { CatalogueCopy, syncSince } from './catalogue-copy';

const view = (items: CatalogueView['items'], extra: Partial<CatalogueView> = {}) => ({
  items,
  stock: null,
  serverTime: '2026-11-21T10:00:00.000Z',
  ...extra,
});

describe('the catalogue copy', () => {
  test('finds an item by barcode, by its own code in any case, and a pack by its barcode', () => {
    const copy = new CatalogueCopy();
    const pack = {
      id: '00000000-0000-4000-8000-0000000000b1',
      unitCode: 'box' as const,
      unitName: null,
      size: 12_000,
      sellingPrice: null,
      mrp: null,
      soldAsPack: true,
    };
    const salt = catalogueItem({
      packs: [pack],
      barcodes: [
        { code: '8901234567890', packId: null },
        { code: '8901234567999', packId: pack.id },
      ],
    });
    copy.apply(view([salt]), true);
    expect(copy.lookup('8901234567890')).toEqual({ kind: 'item', item: salt, packId: null });
    expect(copy.lookup('8901234567999')).toEqual({ kind: 'item', item: salt, packId: pack.id });
    expect(copy.lookup('salt1')).toEqual({ kind: 'item', item: salt, packId: null });
    expect(copy.lookup('0000')).toEqual({ kind: 'unknown' });
  });

  test("says an archived item's code is archived", () => {
    const copy = new CatalogueCopy();
    copy.apply(
      view([
        {
          id: '00000000-0000-4000-8000-0000000000a2',
          archived: true,
          name: 'Old soap',
          barcodes: [{ code: '8900000000001', packId: null }],
        },
      ]),
      true,
    );
    expect(copy.lookup('8900000000001')).toEqual({ kind: 'archived', name: 'Old soap' });
  });

  test('a sync replaces changed items, drops their old codes and keeps the rest', () => {
    const copy = new CatalogueCopy();
    const salt = catalogueItem();
    const rice = catalogueItem({
      id: '00000000-0000-4000-8000-0000000000a3',
      name: 'Basmati rice',
      code: 'RICE',
      stockUnit: 'kg',
      barcodes: [],
    });
    copy.apply(view([salt, rice]), true);
    const renamed = catalogueItem({
      name: 'Tata Salt',
      version: 2,
      barcodes: [{ code: '8901234560000', packId: null }],
    });
    copy.apply(view([renamed]), false);
    expect(copy.lookup('8901234567890')).toEqual({ kind: 'unknown' });
    expect(copy.lookup('8901234560000')).toEqual({ kind: 'item', item: renamed, packId: null });
    expect(copy.search('rice')).toEqual([rice]);
    expect(copy.search('tata')).toEqual([renamed]);
  });

  test('an item archived by a sync leaves the search', () => {
    const copy = new CatalogueCopy();
    copy.apply(view([catalogueItem()]), true);
    copy.apply(
      view([
        {
          id: '00000000-0000-4000-8000-0000000000a1',
          archived: true,
          name: 'Tata Salt 1 kg',
          barcodes: [],
        },
      ]),
      false,
    );
    expect(copy.search('salt')).toEqual([]);
    expect(copy.lookup('SALT1')).toEqual({ kind: 'unknown' });
  });

  test('a full load forgets what it no longer sends; stock comes and goes with the view', () => {
    const copy = new CatalogueCopy();
    const salt = catalogueItem();
    copy.apply(
      view([salt], { stock: [{ itemId: salt.id, quantity: 4_000, lowStockLevel: null }] }),
      true,
    );
    expect(copy.stockOf(salt.id)).toEqual({
      itemId: salt.id,
      quantity: 4_000,
      lowStockLevel: null,
    });
    copy.apply(view([]), true);
    expect(copy.get(salt.id)).toBeUndefined();
    expect(copy.stockOf(salt.id)).toBeUndefined();
  });

  test('a sync updates the stock it sends and keeps the rest', () => {
    const copy = new CatalogueCopy();
    const salt = catalogueItem();
    const rice = catalogueItem({ id: '00000000-0000-4000-8000-0000000000a3', barcodes: [] });
    copy.apply(
      view([salt, rice], {
        stock: [
          { itemId: salt.id, quantity: 4_000, lowStockLevel: null },
          { itemId: rice.id, quantity: 9_000, lowStockLevel: null },
        ],
      }),
      true,
    );
    copy.apply(
      view([], { stock: [{ itemId: salt.id, quantity: 3_000, lowStockLevel: null }] }),
      false,
    );
    expect(copy.stockOf(salt.id)?.quantity).toBe(3_000);
    expect(copy.stockOf(rice.id)?.quantity).toBe(9_000);
  });

  test('looks a code up among 5,000 items in well under 5 ms', () => {
    const copy = new CatalogueCopy();
    const items = Array.from({ length: 5_000 }, (_, index) =>
      catalogueItem({
        id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        name: `Item ${String(index)}`,
        code: `C${String(index)}`,
        barcodes: [{ code: `89000000${String(index).padStart(5, '0')}`, packId: null }],
      }),
    );
    copy.apply(view(items), true);
    const start = performance.now();
    for (let index = 0; index < 100; index += 1) copy.lookup('8900000004999');
    expect((performance.now() - start) / 100).toBeLessThan(5);
    expect(copy.lookup('8900000004999')).toMatchObject({
      kind: 'item',
      item: { name: 'Item 4999' },
    });
  });

  test('the next sync asks from 60 s before the last server time (the overlap)', () => {
    expect(syncSince('2026-11-21T10:00:00.000Z')).toBe('2026-11-21T09:59:00.000Z');
  });
});
