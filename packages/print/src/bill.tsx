// The bill template (P1.15, design section 3): one set of React components for the receipt
// printer (80 and 58 mm) and A4, used by the browser (printing) and the worker (PDFs). It draws
// only the numbers saved with the bill (ADR 0047) and never works out GST again. It uses class
// names only, never `style=`, because the page's CSP refuses inline styles; the stylesheet for
// each size is `printCss`. React escapes everything the shop typed.
import {
  formatPaise,
  stateByCode,
  type BillBuyerView,
  type BillDetailView,
  type BillLineView,
  type PrintSize,
} from '@business-software/shared';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { amount, formatDate, formatDateTime, formatQuantity, formatRate } from './format.js';
import { LABELS, type Labels } from './labels.js';
import { amountInWords } from './words.js';

export interface RenderOptions {
  size: PrintSize;
  /** An ISO moment: when this copy was printed again. Absent on the first print (`02` #33). */
  reprintedAt?: string | null;
}

interface Sum {
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
}
export type RateRow = Sum & { rateBasisPoints: number };
export type HsnRow = RateRow & { hsn: string };

const ZERO: Sum = { taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, totalPaise: 0 };

function add(sum: Sum, line: BillLineView): Sum {
  return {
    taxablePaise: sum.taxablePaise + line.taxablePaise,
    cgstPaise: sum.cgstPaise + line.cgstPaise,
    sgstPaise: sum.sgstPaise + line.sgstPaise,
    igstPaise: sum.igstPaise + line.igstPaise,
    totalPaise: sum.totalPaise + line.totalPaise,
  };
}

/** The saved lines added up per rate, lowest first: the tax table of a receipt. */
export function taxByRate(lines: readonly BillLineView[]): RateRow[] {
  const rows = new Map<number, Sum>();
  for (const line of lines) {
    rows.set(line.rateBasisPoints, add(rows.get(line.rateBasisPoints) ?? ZERO, line));
  }
  return [...rows]
    .map(([rateBasisPoints, sum]) => ({ rateBasisPoints, ...sum }))
    .sort((a, b) => a.rateBasisPoints - b.rateBasisPoints);
}

/** The same per HSN code and rate (the GSTR-1 HSN table's shape): A4's tax summary. */
export function taxByHsn(lines: readonly BillLineView[]): HsnRow[] {
  const rows = new Map<string, HsnRow>();
  for (const line of lines) {
    const key = `${String(line.rateBasisPoints)}/${line.hsn}`;
    const row = rows.get(key) ?? { ...ZERO, rateBasisPoints: line.rateBasisPoints, hsn: line.hsn };
    rows.set(key, { ...row, ...add(row, line) });
  }
  return [...rows.values()].sort(
    (a, b) => a.rateBasisPoints - b.rateBasisPoints || a.hsn.localeCompare(b.hsn),
  );
}

interface Context {
  bill: BillDetailView;
  labels: Labels;
  /** A tax invoice: tax is shown line by line and in the summary. */
  showTax: boolean;
  /**
   * `02` #24 asks for the HSN on every line of a regular business's bill. A bill of supply
   * prints the HSN its items carry (the requirements are silent); a plain bill never does.
   */
  showHsn: boolean;
  /** The seller's and the buyer's GSTIN: not on a plain bill. */
  showGstin: boolean;
  reprintedAt: string | null;
}

type Total = 'taxableBeforeDiscountsPaise' | 'discountOffTaxablePaise';
const sumOf = (lines: readonly BillLineView[], key: Total) =>
  lines.reduce((total, line) => total + line[key], 0);

function itemName(line: BillLineView, bill: BillDetailView): string {
  return bill.language === 'hi' && line.itemHindiName !== null ? line.itemHindiName : line.itemName;
}

function stateName(code: string): string {
  const state = stateByCode(code);
  return state === undefined ? code : `${state.name} (${code})`;
}

/** The state half of GST is called UTGST in a Union Territory without a legislature. */
function stateTax(bill: BillDetailView): 'SGST' | 'UTGST' {
  return stateByCode(bill.placeOfSupplyStateCode)?.utgst === true ? 'UTGST' : 'SGST';
}

function signed(paise: number): string {
  return `${paise > 0 ? '+' : ''}${amount(paise)}`;
}

function address(parts: readonly (string | null)[]): string {
  return parts.filter((part) => part !== null && part !== '').join(' ');
}

function Header({ ctx }: { ctx: Context }): ReactNode {
  const { seller } = ctx.bill;
  const { labels } = ctx;
  return (
    <header className="shop">
      <h1 className="shop-name">{seller.businessName}</h1>
      {address([seller.address, seller.pinCode]) !== '' && (
        <p>{address([seller.address, seller.pinCode])}</p>
      )}
      {ctx.showGstin && seller.gstin !== null && <p>GSTIN: {seller.gstin}</p>}
      {(seller.phone ?? '') !== '' && (
        <p>
          {labels.phone}: {seller.phone}
        </p>
      )}
      {seller.drugLicence !== null && (
        <p>
          {labels.drugLicence}: {seller.drugLicence}
        </p>
      )}
      {seller.fssai !== null && <p>FSSAI: {seller.fssai}</p>}
    </header>
  );
}

/**
 * CGST Rule 5(1)(f): a composition business (the only one that makes a bill of supply, `00` #6)
 * says this at the top of it, in these words, whatever the bill language.
 */
const COMPOSITION_DECLARATION =
  'Composition taxable person, not eligible to collect tax on supplies';

function Title({ ctx }: { ctx: Context }): ReactNode {
  const { labels, bill } = ctx;
  return (
    <>
      {bill.document === 'bill_of_supply' && (
        <p className="declaration">{COMPOSITION_DECLARATION}</p>
      )}
      <h2 className="title">{labels.documents[bill.document]}</h2>
      {ctx.reprintedAt !== null && (
        <p className="reprint">
          <strong>{labels.reprint}</strong> <span>{formatDateTime(ctx.reprintedAt).date}</span>
        </p>
      )}
    </>
  );
}

function Meta({ ctx }: { ctx: Context }): ReactNode {
  const { labels, bill } = ctx;
  const rows: [string, string][] = [
    [labels.billNo, bill.number],
    [labels.date, formatDate(bill.businessDate)],
    [labels.time, formatDateTime(bill.createdAt).time],
    ...(bill.cashierName === null
      ? []
      : [[labels.cashier, bill.cashierName] satisfies [string, string]]),
  ];
  return (
    <dl className="meta">
      {rows.map(([name, value]) => (
        <div key={name}>
          <dt>{name}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Buyer({ ctx, buyer }: { ctx: Context; buyer: BillBuyerView }): ReactNode {
  const place = address([buyer.address, buyer.pinCode]);
  return (
    <section className="buyer">
      <h3>{ctx.labels.billedTo}</h3>
      <p className="buyer-name">{buyer.name}</p>
      {buyer.legalName !== null && buyer.legalName !== buyer.name && <p>{buyer.legalName}</p>}
      {place !== '' && <p>{place}</p>}
      {buyer.stateCode !== null && <p>{stateName(buyer.stateCode)}</p>}
      {ctx.showGstin && buyer.gstin !== null && <p>GSTIN: {buyer.gstin}</p>}
    </section>
  );
}

function PlaceOfSupply({ ctx }: { ctx: Context }): ReactNode {
  if (!ctx.showTax || ctx.bill.tax !== 'igst') return null;
  return (
    <p className="supply">
      {ctx.labels.placeOfSupply}: {stateName(ctx.bill.placeOfSupplyStateCode)}
    </p>
  );
}

/** The ways the bill was paid, and the change handed back from the cash. */
function Payments({ ctx }: { ctx: Context }): ReactNode {
  const { bill, labels } = ctx;
  const tendered = bill.payments.find((payment) => payment.mode === 'cash')?.tenderedPaise ?? null;
  return (
    <section className="payments">
      <h3>{labels.paidBy}</h3>
      {bill.payments.map((payment, index) => (
        <div className="row" key={index}>
          <span>
            {labels.payment[payment.mode] ?? payment.mode}
            {payment.reference !== null && <small> {payment.reference}</small>}
          </span>
          <span>{amount(payment.amountPaise)}</span>
        </div>
      ))}
      {tendered !== null && bill.changePaise > 0 && (
        <>
          <div className="row">
            <span>{labels.cashGiven}</span>
            <span>{amount(tendered)}</span>
          </div>
          <div className="row">
            <span>{labels.change}</span>
            <span>{amount(bill.changePaise)}</span>
          </div>
        </>
      )}
    </section>
  );
}

function Footer({ ctx }: { ctx: Context }): ReactNode {
  const note = ctx.bill.footerNote;
  return note === null || note === '' ? null : <p className="note">{note}</p>;
}

// ---- Receipt (80 and 58 mm) ----

function ReceiptLine({ ctx, line }: { ctx: Context; line: BillLineView }): ReactNode {
  const { labels, bill } = ctx;
  return (
    <div className="line">
      <div className="name">{itemName(line, bill)}</div>
      <div className="calc">
        <span>
          {formatQuantity(line.quantityThousandths)} {labels.units[line.unit] ?? line.unit} ×{' '}
          {amount(line.unitPricePaise)}
          {ctx.showTax && line.priceIncludesTax && <small> {labels.inclusive}</small>}
        </span>
        <span className="amt">{amount(line.taxableBeforeDiscountsPaise)}</span>
      </div>
      {ctx.showHsn && line.hsn !== '' && (
        <div className="fine">
          <span>HSN {line.hsn}</span>
          {ctx.showTax && <span>GST {formatRate(line.rateBasisPoints)}</span>}
        </div>
      )}
      {line.discountOffTaxablePaise > 0 && (
        <div className="fine">
          <span>{labels.discount}</span>
          <span>-{amount(line.discountOffTaxablePaise)}</span>
        </div>
      )}
    </div>
  );
}

function ReceiptTaxRows({ ctx }: { ctx: Context }): ReactNode {
  const { bill, labels } = ctx;
  return (
    <section className="taxes">
      {taxByRate(bill.lines).map((row) => (
        <div className="trow" key={row.rateBasisPoints}>
          <span className="tbase">
            {formatRate(row.rateBasisPoints)}: {amount(row.taxablePaise)}
          </span>
          {bill.tax === 'igst' ? (
            <span>
              IGST {formatRate(row.rateBasisPoints)} {amount(row.igstPaise)}
            </span>
          ) : (
            <>
              <span>
                CGST {formatRate(row.rateBasisPoints / 2)} {amount(row.cgstPaise)}
              </span>
              <span>
                {stateTax(bill)} {formatRate(row.rateBasisPoints / 2)} {amount(row.sgstPaise)}
              </span>
            </>
          )}
        </div>
      ))}
      <div className="row strong">
        <span>{labels.totalTax}</span>
        <span>{amount(bill.cgstPaise + bill.sgstPaise + bill.igstPaise)}</span>
      </div>
    </section>
  );
}

function Receipt({ ctx }: { ctx: Context }): ReactNode {
  const { bill, labels } = ctx;
  const discount = sumOf(bill.lines, 'discountOffTaxablePaise');
  return (
    <>
      <Header ctx={ctx} />
      <Title ctx={ctx} />
      <Meta ctx={ctx} />
      <PlaceOfSupply ctx={ctx} />
      {bill.buyer !== null && <Buyer ctx={ctx} buyer={bill.buyer} />}
      <section className="lines">
        {bill.lines.map((line) => (
          <ReceiptLine ctx={ctx} line={line} key={line.lineNo} />
        ))}
      </section>
      <section className="totals">
        {discount > 0 && (
          <>
            <div className="row">
              <span>{labels.subtotal}</span>
              <span>{amount(sumOf(bill.lines, 'taxableBeforeDiscountsPaise'))}</span>
            </div>
            <div className="row">
              <span>{labels.discount}</span>
              <span>-{amount(discount)}</span>
            </div>
          </>
        )}
        {ctx.showTax && (
          <div className="row">
            <span>{labels.taxableValue}</span>
            <span>{amount(bill.taxablePaise)}</span>
          </div>
        )}
      </section>
      {ctx.showTax && <ReceiptTaxRows ctx={ctx} />}
      <section className="totals">
        {bill.roundOffPaise !== 0 && (
          <div className="row">
            <span>{labels.roundOff}</span>
            <span>{signed(bill.roundOffPaise)}</span>
          </div>
        )}
        <div className="row grand">
          <span>{labels.grandTotal}</span>
          <span>{formatPaise(bill.grandTotalPaise)}</span>
        </div>
      </section>
      <Payments ctx={ctx} />
      <Footer ctx={ctx} />
    </>
  );
}

// ---- A4 ----

function A4Table({ ctx }: { ctx: Context }): ReactNode {
  const { bill, labels } = ctx;
  const discounted = sumOf(bill.lines, 'discountOffTaxablePaise') > 0;
  const igst = bill.tax === 'igst';
  return (
    <table className="items">
      <thead>
        <tr>
          <th>#</th>
          <th className="left">{labels.item}</th>
          {ctx.showHsn && <th>HSN</th>}
          <th>{labels.qty}</th>
          <th>{labels.rate}</th>
          {discounted && <th>{labels.discount}</th>}
          <th>{ctx.showTax ? labels.taxable : labels.amount}</th>
          {ctx.showTax && <th>{igst ? 'IGST' : 'CGST'}</th>}
          {ctx.showTax && !igst && <th>{stateTax(bill)}</th>}
          {ctx.showTax && <th>{labels.total}</th>}
        </tr>
      </thead>
      <tbody>
        {bill.lines.map((line) => (
          <tr key={line.lineNo}>
            <td>{line.lineNo}</td>
            <td className="left name">{itemName(line, bill)}</td>
            {ctx.showHsn && <td>{line.hsn}</td>}
            <td>
              {formatQuantity(line.quantityThousandths)} {labels.units[line.unit] ?? line.unit}
            </td>
            <td>
              {amount(line.unitPricePaise)}
              {ctx.showTax && line.priceIncludesTax && <small> {labels.inclusive}</small>}
            </td>
            {discounted && <td>{amount(line.discountOffTaxablePaise)}</td>}
            <td>{amount(line.taxablePaise)}</td>
            {ctx.showTax && (
              <td>
                {amount(igst ? line.igstPaise : line.cgstPaise)}
                <small> {formatRate(igst ? line.rateBasisPoints : line.rateBasisPoints / 2)}</small>
              </td>
            )}
            {ctx.showTax && !igst && (
              <td>
                {amount(line.sgstPaise)}
                <small> {formatRate(line.rateBasisPoints / 2)}</small>
              </td>
            )}
            {ctx.showTax && <td>{amount(line.totalPaise)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function A4TaxSummary({ ctx }: { ctx: Context }): ReactNode {
  const { bill, labels } = ctx;
  const igst = bill.tax === 'igst';
  return (
    <section className="summary">
      <h3>{labels.taxSummary}</h3>
      <table>
        <thead>
          <tr>
            <th className="left">HSN</th>
            <th>{labels.rate}</th>
            <th>{labels.taxable}</th>
            <th>{igst ? 'IGST' : 'CGST'}</th>
            {!igst && <th>{stateTax(bill)}</th>}
          </tr>
        </thead>
        <tbody>
          {taxByHsn(bill.lines).map((row) => (
            <tr key={`${String(row.rateBasisPoints)}/${row.hsn}`}>
              <td className="left">{row.hsn}</td>
              <td>{formatRate(row.rateBasisPoints)}</td>
              <td>{amount(row.taxablePaise)}</td>
              <td>{amount(igst ? row.igstPaise : row.cgstPaise)}</td>
              {!igst && <td>{amount(row.sgstPaise)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function A4Totals({ ctx }: { ctx: Context }): ReactNode {
  const { bill, labels } = ctx;
  const discount = sumOf(bill.lines, 'discountOffTaxablePaise');
  return (
    <section className="totals">
      {discount > 0 && (
        <>
          <div className="row">
            <span>{labels.subtotal}</span>
            <span>{amount(sumOf(bill.lines, 'taxableBeforeDiscountsPaise'))}</span>
          </div>
          <div className="row">
            <span>{labels.discount}</span>
            <span>-{amount(discount)}</span>
          </div>
        </>
      )}
      {ctx.showTax && (
        <>
          <div className="row">
            <span>{labels.taxableValue}</span>
            <span>{amount(bill.taxablePaise)}</span>
          </div>
          {bill.tax === 'igst' ? (
            <div className="row">
              <span>IGST</span>
              <span>{amount(bill.igstPaise)}</span>
            </div>
          ) : (
            <>
              <div className="row">
                <span>CGST</span>
                <span>{amount(bill.cgstPaise)}</span>
              </div>
              <div className="row">
                <span>{stateTax(bill)}</span>
                <span>{amount(bill.sgstPaise)}</span>
              </div>
            </>
          )}
        </>
      )}
      {bill.roundOffPaise !== 0 && (
        <div className="row">
          <span>{labels.roundOff}</span>
          <span>{signed(bill.roundOffPaise)}</span>
        </div>
      )}
      <div className="row grand">
        <span>{labels.grandTotal}</span>
        <span>{formatPaise(bill.grandTotalPaise)}</span>
      </div>
    </section>
  );
}

function A4({ ctx }: { ctx: Context }): ReactNode {
  const { bill, labels } = ctx;
  return (
    <>
      <div className="top">
        <Header ctx={ctx} />
        <div className="doc">
          <Title ctx={ctx} />
          <Meta ctx={ctx} />
          <PlaceOfSupply ctx={ctx} />
        </div>
      </div>
      {bill.buyer !== null && <Buyer ctx={ctx} buyer={bill.buyer} />}
      <A4Table ctx={ctx} />
      <div className="bottom">
        <div className="left-column">
          {ctx.showTax && <A4TaxSummary ctx={ctx} />}
          <p className="words">
            <strong>{labels.amountInWords}:</strong>{' '}
            {amountInWords(bill.grandTotalPaise, bill.language)}
          </p>
          <Payments ctx={ctx} />
        </div>
        <A4Totals ctx={ctx} />
      </div>
      <Footer ctx={ctx} />
      <div className="signature">
        <p>
          {labels.forBusiness} {bill.seller.businessName}
        </p>
        <p className="sign-line">{labels.signatory}</p>
      </div>
    </>
  );
}

function Bill({ bill, options }: { bill: BillDetailView; options: RenderOptions }): ReactNode {
  const ctx: Context = {
    bill,
    labels: LABELS[bill.language],
    showTax: bill.document === 'tax_invoice',
    showHsn: bill.document !== 'bill',
    showGstin: bill.document !== 'bill',
    reprintedAt: options.reprintedAt ?? null,
  };
  const size = options.size === 'a4' ? 'a4' : `s${options.size}`;
  return (
    <article className={`bill ${size} d-${bill.document}`}>
      {options.size === 'a4' ? <A4 ctx={ctx} /> : <Receipt ctx={ctx} />}
    </article>
  );
}

/**
 * The bill as HTML, ready to go in a page that carries `printCss` for the same size. The page
 * sets the language (`lang`) and loads the fonts.
 */
export function renderBill(bill: BillDetailView, options: RenderOptions): string {
  return renderToStaticMarkup(<Bill bill={bill} options={options} />);
}
