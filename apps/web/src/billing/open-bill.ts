import {
  billCartSchema,
  calculateBill,
  cartToBillInput,
  linePrice,
  stockQuantityProblem,
  type Bill,
  type BillCart,
  type BillingContext,
  type BuiltInUnit,
  type CartLine,
  type CartPricing,
  type CatalogueItem,
  type TaxScheme,
} from '@business-software/shared';
import type { CatalogueCopy } from './catalogue-copy';

/** The bill on the screen: a held bill's cart, but possibly still empty. */
export interface OpenBill extends CartPricing {
  billKey: string;
  customerId: string | null;
  lines: CartLine[];
}

/** A cart that came back from the server or storage, as the screen keeps it. */
export function fromCart(cart: BillCart): OpenBill {
  return {
    billKey: cart.billKey,
    priceList: cart.priceList,
    customerId: cart.customerId,
    placeOfSupplyStateCode: cart.placeOfSupplyStateCode,
    lines: cart.lines.map(({ discount, ...line }) =>
      discount === undefined ? line : { ...line, discount },
    ),
    ...(cart.billDiscount === undefined ? {} : { billDiscount: cart.billDiscount }),
  };
}

/** A new bill: retail, a walk-in, supplied in the branch's own state (design §7). */
export function startBill(branchStateCode: string): OpenBill {
  return {
    billKey: crypto.randomUUID(),
    priceList: 'retail',
    customerId: null,
    placeOfSupplyStateCode: branchStateCode,
    lines: [],
  };
}

// `3*` before a code or a search sets the quantity (design §3); up to three decimals.
const QUANTITY_PREFIX = /^\s*(\d{1,6}(?:\.\d{1,3})?)\s*\*\s*(\S.*)$/;

/** Splits `3*8901234567890` into a quantity (thousandths) and what to look up. */
export function parseEntry(text: string): { quantityThousandths: number | null; query: string } {
  const match = QUANTITY_PREFIX.exec(text);
  const quantity = match ? Math.round(Number(match[1]) * 1_000) : 0;
  if (match?.[2] === undefined || quantity <= 0) return { quantityThousandths: null, query: text };
  return { quantityThousandths: quantity, query: match[2].trim() };
}

/**
 * The bill with every line at the copy's current price (after a sync, or a switch between retail
 * and wholesale), and the lines whose price changed. A line that can't be priced is left as it is.
 */
export function repriceBill(
  bill: OpenBill,
  copy: CatalogueCopy,
): { bill: OpenBill; changed: number[] } {
  const changed: number[] = [];
  const lines = bill.lines.map((line, index) => {
    const item = copy.get(line.itemId);
    if (item === undefined || item.archived) return line;
    let price: number;
    try {
      price = linePrice(item, line.packId, bill.priceList);
    } catch {
      return line;
    }
    if (price === line.shownUnitPricePaise) return line;
    changed.push(index);
    return { ...line, shownUnitPricePaise: price };
  });
  return { bill: changed.length === 0 ? bill : { ...bill, lines }, changed };
}

/** Weighed or measured: adding one moves to its quantity box (design §3). */
const LOOSE_UNITS: ReadonlySet<BuiltInUnit> = new Set(['kg', 'g', 'litre', 'ml', 'metre', 'foot']);

export function isLoose(item: CatalogueItem, packId: string | null): boolean {
  return packId === null && LOOSE_UNITS.has(item.stockUnit);
}

/** Why `quantityThousandths` can't be sold on a line, or null. An owner's own unit is whole. */
export function quantityProblem(
  item: CatalogueItem,
  packId: string | null,
  quantityThousandths: number,
): 'invalid' | 'whole_units_only' | null {
  const pack = item.packs.find((candidate) => candidate.id === packId);
  const unit = pack === undefined ? item.stockUnit : (pack.unitCode ?? 'pack');
  return stockQuantityProblem(unit, quantityThousandths);
}

/**
 * The items the bill takes more of than the branch has (design §5), with what the branch has.
 * Only goods with a known stock (the caller has `stock.view`) are checked; the save re-checks.
 */
export function shortOfStock(lines: readonly CartLine[], copy: CatalogueCopy): Map<string, number> {
  const wanted = new Map<string, number>();
  for (const line of lines) {
    const item = copy.get(line.itemId);
    if (item === undefined || item.archived || item.kind !== 'goods') continue;
    const size = item.packs.find((pack) => pack.id === line.packId)?.size ?? 1_000;
    const units = (line.quantityThousandths * size) / 1_000;
    wanted.set(line.itemId, (wanted.get(line.itemId) ?? 0) + units);
  }
  const short = new Map<string, number>();
  for (const [itemId, quantity] of wanted) {
    const stock = copy.stockOf(itemId);
    if (stock !== undefined && quantity > stock.quantity) short.set(itemId, stock.quantity);
  }
  return short;
}

/** Why a line can't be priced: its item is gone or archived, or has no GST rate or HSN. */
export function lineProblem(
  line: CartLine,
  copy: CatalogueCopy,
  scheme: TaxScheme,
): 'gone' | 'no_gst' | null {
  const item = copy.get(line.itemId);
  if (item === undefined || item.archived) return 'gone';
  if (
    line.packId !== null &&
    !item.packs.some((pack) => pack.id === line.packId && pack.soldAsPack)
  ) {
    return 'gone';
  }
  if (scheme === 'regular' && (item.gstRate === null || item.hsn === null)) return 'no_gst';
  return null;
}

/**
 * The bill as the GST engine works it out (design §5: the screen shows exactly this), or null
 * while it is empty or a line can't be priced.
 */
export function priceOpenBill(
  bill: OpenBill,
  context: BillingContext,
  copy: CatalogueCopy,
): Bill | null {
  if (bill.lines.length === 0) return null;
  if (bill.lines.some((line) => lineProblem(line, copy, context.scheme) !== null)) return null;
  return calculateBill(
    cartToBillInput(bill, {
      scheme: context.scheme,
      supplierStateCode: context.branchStateCode,
      catalogue: copy.entries,
    }),
  );
}

// The open bill survives a reload in this tab (design §5), and goes when Chrome closes or the
// person logs out (`00` #40).
const PREFIX = 'bill:';

export function saveOpenBill(userId: string, bill: OpenBill): void {
  try {
    if (bill.lines.length === 0) sessionStorage.removeItem(PREFIX + userId);
    else sessionStorage.setItem(PREFIX + userId, JSON.stringify(bill));
  } catch {
    // Storage full or blocked: the bill still lives on the screen.
  }
}

export function loadOpenBill(userId: string): OpenBill | null {
  try {
    const stored = sessionStorage.getItem(PREFIX + userId);
    if (stored === null) return null;
    const parsed = billCartSchema.safeParse(JSON.parse(stored));
    return parsed.success ? fromCart(parsed.data) : null;
  } catch {
    return null;
  }
}

export function clearOpenBills(): void {
  try {
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith(PREFIX)) sessionStorage.removeItem(key);
    }
  } catch {
    // Nothing to clear.
  }
}
