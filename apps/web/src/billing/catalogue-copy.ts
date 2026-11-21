import {
  createCatalogueSearch,
  type CatalogueEntry,
  type CatalogueItem,
  type CatalogueStock,
  type CatalogueView,
} from '@business-software/shared';

/** What a scanned or typed code is. */
export type Lookup =
  | { kind: 'item'; item: CatalogueItem; packId: string | null }
  | { kind: 'archived'; name: string }
  | { kind: 'unknown' };

/** How far back each sync reaches before the last answer's time (design §4, ADR 0043). */
export const SYNC_OVERLAP_MS = 60_000;

/** The `since` for the next sync: 60 s before the server's time, longer than any transaction. */
export function syncSince(serverTime: string): string {
  return new Date(Date.parse(serverTime) - SYNC_OVERLAP_MS).toISOString();
}

interface CodeTarget {
  itemId: string;
  packId: string | null;
}

/**
 * The billing counter's copy of the catalogue (design §4, ADR 0043), in memory only: a scan is a
 * map lookup, never a request. Syncs run one at a time and each answer is the database as it was
 * then, so a later answer always replaces an earlier one; no version comparison is needed.
 */
export class CatalogueCopy {
  #entries = new Map<string, CatalogueEntry>();
  /** Barcodes as printed, and items' own codes in lower case. */
  #barcodes = new Map<string, CodeTarget>();
  #itemCodes = new Map<string, string>();
  #stock = new Map<string, CatalogueStock>();
  #search: ((query: string, limit?: number) => CatalogueItem[]) | null = null;
  serverTime: string | null = null;

  /** Takes a whole catalogue (`full`) or a sync's changes. */
  apply(view: CatalogueView, full: boolean): void {
    if (full) {
      this.#entries.clear();
      this.#barcodes.clear();
      this.#itemCodes.clear();
      this.#stock.clear();
    }
    for (const entry of view.items) {
      const old = this.#entries.get(entry.id);
      if (old !== undefined) this.#forgetCodes(old);
      this.#entries.set(entry.id, entry);
      for (const barcode of entry.barcodes) {
        this.#barcodes.set(barcode.code, { itemId: entry.id, packId: barcode.packId });
      }
      if (!entry.archived && entry.code !== null) {
        this.#itemCodes.set(entry.code.toLowerCase(), entry.id);
      }
    }
    for (const row of view.stock ?? []) this.#stock.set(row.itemId, row);
    if (full || view.items.length > 0) this.#search = null;
    this.serverTime = view.serverTime;
  }

  #forgetCodes(entry: CatalogueEntry): void {
    for (const barcode of entry.barcodes) {
      if (this.#barcodes.get(barcode.code)?.itemId === entry.id) {
        this.#barcodes.delete(barcode.code);
      }
    }
    if (!entry.archived && entry.code !== null) {
      const code = entry.code.toLowerCase();
      if (this.#itemCodes.get(code) === entry.id) this.#itemCodes.delete(code);
    }
  }

  get entries(): ReadonlyMap<string, CatalogueEntry> {
    return this.#entries;
  }

  get(id: string): CatalogueEntry | undefined {
    return this.#entries.get(id);
  }

  stockOf(itemId: string): CatalogueStock | undefined {
    return this.#stock.get(itemId);
  }

  /** A barcode first (it can name a pack), then an item's own code, ignoring case. */
  lookup(code: string): Lookup {
    const target = this.#barcodes.get(code) ?? {
      itemId: this.#itemCodes.get(code.toLowerCase()) ?? '',
      packId: null,
    };
    const entry = this.#entries.get(target.itemId);
    if (entry === undefined) return { kind: 'unknown' };
    if (entry.archived) return { kind: 'archived', name: entry.name };
    return { kind: 'item', item: entry, packId: target.packId };
  }

  /** The live items matching `query`, best first (built again only after a change). */
  search(query: string, limit?: number): CatalogueItem[] {
    this.#search ??= createCatalogueSearch(
      [...this.#entries.values()].filter((entry): entry is CatalogueItem => !entry.archived),
    );
    return this.#search(query, limit);
  }
}
