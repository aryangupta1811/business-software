// The demo shop's seed (P1.20, ADR 0016 option C): a fictional kirana store built entirely through
// the app's own HTTP routes, so the data obeys every rule the real counter does. Stock matches its
// movements, every bill has its number and its log entries, GST and udhaar balances are the
// services' own. Nothing is inserted into a table directly.
//
// How history gets old: the API runs inside this process with a clock the seed sets (the `CLOCK`
// the services already read their business date from, P1.8), then walks the clock through the
// days, logging the owner and the cashier in each morning. `entry_log.created_at` stays the real
// seeding time, because only the database sets it (ADR 0028's note); the flag rules count by the
// business date stored in the entry, so the history still spreads its flags over its weeks.
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createDatabase, type Database } from '@business-software/db';
import {
  businessDate,
  calculateBill,
  cartToBillInput,
  DEMO_CASHIER_USERNAME,
  DEMO_PASSWORD,
  linePrice,
  type BillDraft,
  type CartLine,
  type CatalogueEntry,
  type CatalogueItem,
  type CatalogueView,
  type ItemView,
} from '@business-software/shared';
import { createApp } from '../app.js';
import type { Clock } from '../auth/clock.js';
import { createRandom, type Random } from './prng.js';
import { registerDemoBusiness } from './registry.js';
import {
  BUSINESS_CUSTOMER,
  CATEGORIES,
  CUSTOMERS,
  FESTIVALS,
  ITEMS,
  SERVICE,
  SHOP,
  STAFF,
  type DemoCustomer,
  type DemoItem,
} from './shop.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** The owner locks after this many idle minutes; the seed raises it while it works. */
const SEED_OWNER_LOCK_MINUTES = 30;
const SEED_STAFF_IDLE_MINUTES = 120;
/** The security settings a new business starts with, put back when the seed has finished. */
const DEFAULT_OWNER_LOCK_MINUTES = 5;
const DEFAULT_STAFF_IDLE_MINUTES = 30;
/** Longer than this between two requests and the seed sends a "still here" first. */
const HOP_MS = 20 * MINUTE;

export const DEFAULT_SEED = 20_261_124;
export const DEFAULT_HISTORY_DAYS = 42;

/** The services read their time from here; the seed moves it. */
class SimClock implements Clock {
  constructor(public time: number) {}
  now(): Date {
    return new Date(this.time);
  }
}

interface Answer<T> {
  status: number;
  body: T;
}

/** One browser to the in-process API: keeps cookies and the CSRF token, like Chrome does. */
class SeedClient {
  readonly jar = new Map<string, string>();
  csrf = '';

  constructor(
    private readonly base: string,
    private readonly who: string,
    private readonly clock: Clock,
  ) {}

  async call<T = unknown>(method: string, path: string, body?: unknown): Promise<Answer<T>> {
    const response = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        // The one address every seed request comes from, as Caddy would report it.
        'x-forwarded-for': '127.0.0.1',
        'sec-fetch-site': 'same-origin',
        cookie: [...this.jar].map(([name, value]) => `${name}=${value}`).join('; '),
        ...(this.csrf !== '' && { 'x-csrf-token': this.csrf }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair = ''] = cookie.split(';');
      const [name = '', ...value] = pair.split('=');
      if (/Max-Age=0(;|$)/.test(cookie)) this.jar.delete(name);
      else this.jar.set(name, value.join('='));
    }
    const text = await response.text();
    const parsed = (text === '' ? null : JSON.parse(text)) as T;
    const token = (parsed as { csrfToken?: unknown } | null)?.csrfToken;
    if (typeof token === 'string') this.csrf = token;
    return { status: response.status, body: parsed };
  }

  /** The answer's body, or an error that names the request and what the server said. */
  async ok<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const answer = await this.call<T>(method, path, body);
    if (answer.status < 200 || answer.status >= 300) {
      throw new Error(
        `Seed (${this.who}, ${this.clock.now().toISOString()}): ${method} ${path} answered ${String(answer.status)} ${JSON.stringify(answer.body)}`,
      );
    }
    return answer.body;
  }
}

/** The check character a GSTIN ends with, so a made-up number passes the same check a real one does. */
export function gstinWith(first14: string): string {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const product = chars.indexOf(first14.charAt(i)) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return `${first14}${chars.charAt((36 - (sum % 36)) % 36)}`;
}

/** 'YYYY-MM-DD' plus `days`, as a calendar date (UTC arithmetic: no daylight saving to trip on). */
function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

/** The instant of `hh:mm` Indian time on a business date. */
function istInstant(date: string, hour: number, minute: number): number {
  const h = String(hour).padStart(2, '0');
  const m = String(minute).padStart(2, '0');
  return Date.parse(`${date}T${h}:${m}:00+05:30`);
}

/** Day of the week for a business date: 0 = Sunday. */
function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Busy hours of a shop day (weights): the morning rush and the evening one. */
const HOUR_WEIGHTS: readonly [number, number][] = [
  [8, 0.5],
  [9, 2],
  [10, 2.5],
  [11, 1.5],
  [12, 1],
  [13, 0.8],
  [14, 0.6],
  [15, 0.8],
  [16, 1.2],
  [17, 2],
  [18, 3],
  [19, 3],
  [20, 2],
  [21, 0.4],
];

/**
 * What the shelves hold on the first day. The numbers in `shop.ts` are for 42 days, sized so that
 * a few items end the history below their low-stock level and one is out; a shorter history
 * starts with proportionally less, in whole units.
 */
export function openingStock(item: DemoItem, days: number): number {
  const scaled = Math.round((item.opening * days) / DEFAULT_HISTORY_DAYS / 1_000) * 1_000;
  return Math.max(1_000, scaled);
}

/** How many bills a day brings: weekends busy, festival weeks much busier. */
export function billsForDay(date: string, random: Random): number {
  const day = weekday(date);
  const base = day === 6 ? random.int(34, 44) : day === 0 ? random.int(30, 38) : random.int(22, 32);
  let boost = 1;
  for (const festival of FESTIVALS) {
    const daysBefore = (Date.parse(festival.date) - Date.parse(date)) / DAY;
    if (daysBefore >= 0 && daysBefore <= festival.lead) boost = Math.max(boost, festival.boost);
  }
  return Math.round(base * boost);
}

interface Line {
  item: CatalogueItem;
  demo: DemoItem | null;
  packId: string | null;
  quantityThousandths: number;
  /** Thousandths of the stock unit that leave the shelf; 0 for the service. */
  stock: number;
  discountBasisPoints?: number;
}

interface Shop {
  items: { demo: DemoItem; id: string; packId: string | null }[];
  serviceId: string;
  customers: { demo: DemoCustomer; id: string; balance: number; lastPaidOn: string | null }[];
  businessCustomerId: string;
}

export interface SeedOptions {
  /** The runtime database login (`DATABASE_URL`). */
  databaseUrl: string;
  /** The real time the seed runs at: history ends the day before, in Indian time. */
  now: Date;
  /** How many days of history. */
  days?: number;
  /** Changes the shop's random choices; the same seed gives the same shop. */
  seed?: number;
  /** One line per stage. */
  log?: (line: string) => void;
}

export interface SeedResult {
  businessId: string;
  ownerEmail: string;
  firstDay: string;
  lastDay: string;
  days: number;
  bills: number;
  /** Paise: the grand totals of every bill. */
  billedPaise: number;
  udhaarPayments: number;
  stockAdjustments: number;
  /** Items at or below their low-stock level when the history ends. */
  lowStockItems: number;
  seconds: number;
}

/** Builds one new demo shop and registers it as the demo. Never touches an existing business. */
export async function seedDemoShop(options: SeedOptions): Promise<SeedResult> {
  const started = Date.now();
  const log = options.log ?? (() => undefined);
  const days = options.days ?? DEFAULT_HISTORY_DAYS;
  const random = createRandom(options.seed ?? DEFAULT_SEED);
  const lastDay = addDays(businessDate(options.now), -1);
  const firstDay = addDays(lastDay, -(days - 1));
  const clock = new SimClock(istInstant(firstDay, 7, 30));

  const database = createDatabase(options.databaseUrl, (error) => {
    log(`Database pool error: ${error.message}`);
  });
  const app = await createApp(
    {
      databaseUrl: options.databaseUrl,
      host: '127.0.0.1',
      port: 0,
      jsonLogs: false,
      // Plain HTTP on this computer, talking to itself.
      cookieSecure: true,
    },
    { clock },
  );
  app.useLogger(false);
  try {
    await app.listen(0, '127.0.0.1');
    const { port } = (app.getHttpServer() as Server).address() as AddressInfo;
    const base = `http://127.0.0.1:${String(port)}/api`;
    const run = new Seeding(base, clock, random, log, firstDay, lastDay, days);
    const result = await run.build(database);
    return { ...result, seconds: Math.round((Date.now() - started) / 100) / 10 };
  } finally {
    await app.close();
    await database.close();
  }
}

class Seeding {
  private readonly owner: SeedClient;
  private readonly cashier: SeedClient;
  private readonly stock = new Map<string, number>();
  private readonly email: string;
  private bills = 0;
  private billedPaise = 0;
  private udhaarPayments = 0;
  private stockAdjustments = 0;
  private catalogue = new Map<string, CatalogueEntry>();
  private shop: Shop = { items: [], serviceId: '', customers: [], businessCustomerId: '' };
  private nextPayment = new Map<string, string>();
  /** When both sessions last said "still here" (or logged in). */
  private lastPing = 0;

  constructor(
    private readonly base: string,
    private readonly clock: SimClock,
    private readonly random: Random,
    private readonly log: (line: string) => void,
    private readonly firstDay: string,
    private readonly lastDay: string,
    private readonly days: number,
  ) {
    this.owner = new SeedClient(base, 'owner', clock);
    this.cashier = new SeedClient(base, 'cashier', clock);
    // Unique per run: owner emails are unique across businesses (Module 00 #27).
    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    this.email = `demo-owner-${stamp}@example.com`;
  }

  async build(database: Database): Promise<Omit<SeedResult, 'seconds'>> {
    const { owner } = this;
    // Day one: sign up as any owner would, then set the shop up.
    const signup = await owner.ok<{ businessId: string }>('POST', '/signup', {
      businessName: SHOP.name,
      businessType: 'kirana',
      phone: SHOP.phone,
      stateCode: SHOP.stateCode,
      gstStatus: 'regular',
      email: this.email,
      password: DEMO_PASSWORD,
    });
    const businessId = signup.businessId;
    await owner.ok('GET', '/session');
    await this.setUpShop();
    await this.addItems();
    await this.addPeople();
    await this.openStock();
    await this.loginCashier();
    this.log(
      `Shop ready: ${String(this.shop.items.length)} items, ${String(this.shop.customers.length)} customers`,
    );

    const days: string[] = [];
    for (let day = this.firstDay; day <= this.lastDay; day = addDays(day, 1)) days.push(day);
    for (const [index, day] of days.entries()) {
      await this.runDay(day, index);
      if ((index + 1) % 7 === 0 || index === days.length - 1) {
        this.log(
          `Day ${String(index + 1)} of ${String(days.length)} (${day}): ${String(this.bills)} bills so far`,
        );
      }
    }

    // Back to the normal lock times, then everyone logs out.
    await this.moveTo(istInstant(this.lastDay, 22, 0));
    await this.owner.ok('POST', '/session/active');
    await this.putSecurity(DEFAULT_OWNER_LOCK_MINUTES, DEFAULT_STAFF_IDLE_MINUTES);
    await this.cashier.call('POST', '/logout');
    await this.owner.call('POST', '/logout');

    // The last step: it only becomes the demo once it is whole.
    await registerDemoBusiness(database, businessId);
    return {
      businessId,
      ownerEmail: this.email,
      firstDay: this.firstDay,
      lastDay: this.lastDay,
      days: days.length,
      bills: this.bills,
      billedPaise: this.billedPaise,
      udhaarPayments: this.udhaarPayments,
      stockAdjustments: this.stockAdjustments,
      lowStockItems: this.shop.items.filter(
        ({ demo }) => (this.stock.get(demo.name) ?? 0) <= demo.low,
      ).length,
    };
  }

  // ---- Setting up ----

  private putSecurity(ownerLockMinutes: number, staffIdleMinutes: number) {
    return this.owner.ok('PUT', '/settings/security', { ownerLockMinutes, staffIdleMinutes });
  }

  private async setUpShop(): Promise<void> {
    const { owner } = this;
    const current = await owner.ok<{ business: Record<string, unknown> }>('GET', '/settings');
    await owner.ok('PUT', '/settings/business', {
      ...current.business,
      ownerName: SHOP.ownerName,
      address: SHOP.address,
      pinCode: SHOP.pinCode,
      gstin: SHOP.gstin,
    });
    // Long lock times while the clock jumps between visits; put back at the end.
    await this.putSecurity(SEED_OWNER_LOCK_MINUTES, SEED_STAFF_IDLE_MINUTES);
  }

  private async addItems(): Promise<void> {
    const { owner } = this;
    const { id: branchId } = (await owner.ok<{ branch: { id: string } }>('GET', '/session')).branch;
    const categoryIds = new Map<string, string>();
    for (const name of CATEGORIES) {
      const made = await owner.ok<{ id: string }>('POST', '/categories', { name });
      categoryIds.set(name, made.id);
    }
    for (const [index, demo] of ITEMS.entries()) {
      const view = await owner.ok<ItemView>('POST', '/items', {
        kind: 'goods',
        name: demo.name,
        hindiName: demo.hindiName,
        code: null,
        categoryId: categoryIds.get(demo.category) ?? null,
        brand: null,
        stockUnit: demo.unit,
        sellingPrice: demo.price,
        wholesalePrice: null,
        purchasePrice: demo.cost,
        mrp: demo.mrp,
        priceIncludesTax: true,
        gstRate: demo.gst,
        hsn: demo.hsn,
        packs:
          demo.pack === undefined
            ? []
            : [
                {
                  id: null,
                  unitCode: demo.pack.unit,
                  unitId: null,
                  size: demo.pack.size,
                  sellingPrice: null,
                  mrp: null,
                  soldAsPack: true,
                  boughtAsPack: true,
                },
              ],
        levels: [{ branchId, lowStockLevel: demo.low }],
        barcodes: [`DM${String(index + 1).padStart(3, '0')}`],
      });
      this.shop.items.push({ demo, id: view.id, packId: view.packs[0]?.id ?? null });
    }
    const service = await owner.ok<ItemView>('POST', '/items', {
      kind: 'service',
      name: SERVICE.name,
      hindiName: SERVICE.hindiName,
      code: null,
      categoryId: null,
      brand: null,
      stockUnit: 'piece',
      sellingPrice: SERVICE.price,
      wholesalePrice: null,
      purchasePrice: null,
      mrp: null,
      priceIncludesTax: true,
      gstRate: SERVICE.gst,
      hsn: SERVICE.sac,
      packs: [],
      levels: [],
      barcodes: [],
    });
    this.shop.serviceId = service.id;
  }

  private async addPeople(): Promise<void> {
    const { owner } = this;
    const { branch } = await owner.ok<{ branch: { id: string } }>('GET', '/session');
    await owner.ok('POST', '/staff', {
      name: STAFF.cashier.name,
      homeBranchId: branch.id,
      phone: STAFF.cashier.phone,
      weeklyOffDay: STAFF.cashier.weeklyOffDay,
      paidLeavesPerMonth: 2,
      joiningDate: this.firstDay,
      salary: { kind: 'monthly', amountPaise: STAFF.cashier.salary },
      username: DEMO_CASHIER_USERNAME,
      password: DEMO_PASSWORD,
      ownerPassword: DEMO_PASSWORD,
    });
    // A person with no login (`00` #19): on the staff list and, from the next version, the register.
    await owner.ok('POST', '/staff', {
      name: STAFF.helper.name,
      homeBranchId: branch.id,
      phone: STAFF.helper.phone,
      weeklyOffDay: STAFF.helper.weeklyOffDay,
      paidLeavesPerMonth: 1,
      joiningDate: this.firstDay,
      salary: { kind: 'monthly', amountPaise: STAFF.helper.salary },
    });

    for (const demo of CUSTOMERS) {
      const made = await owner.ok<{ id: string }>('POST', '/customers', {
        name: demo.name,
        phone: demo.phone,
        gstin: null,
        legalName: null,
        address: null,
        pinCode: null,
        stateCode: null,
        creditLimitPaise: demo.creditLimit,
        dueDays: demo.dueDays,
      });
      this.shop.customers.push({ demo, id: made.id, balance: 0, lastPaidOn: null });
    }
    const business = await owner.ok<{ id: string }>('POST', '/customers', {
      name: BUSINESS_CUSTOMER.name,
      phone: BUSINESS_CUSTOMER.phone,
      gstin: gstinWith(BUSINESS_CUSTOMER.gstin.slice(0, 14)),
      legalName: BUSINESS_CUSTOMER.legalName,
      address: BUSINESS_CUSTOMER.address,
      pinCode: BUSINESS_CUSTOMER.pinCode,
      stateCode: BUSINESS_CUSTOMER.stateCode,
    });
    this.shop.businessCustomerId = business.id;

    // The old notebook's balances, as of day one (`03` #20).
    for (const customer of this.shop.customers) {
      if (customer.demo.opening === undefined) continue;
      await owner.ok('POST', '/udhaar/opening', {
        requestKey: this.random.uuid(),
        customerId: customer.id,
        amountPaise: customer.demo.opening,
        asOf: this.firstDay,
        reason: 'Balance from the old notebook',
      });
      customer.balance = customer.demo.opening;
    }
  }

  private async openStock(): Promise<void> {
    for (const { demo, id } of this.shop.items) {
      const opening = openingStock(demo, this.days);
      await this.owner.ok('POST', `/items/${id}/stock/opening`, {
        quantity: opening,
        unitCost: null,
        requestKey: this.random.uuid(),
      });
      this.stock.set(demo.name, opening);
    }
    const view = await this.owner.ok<CatalogueView>('GET', '/billing/catalogue');
    this.catalogue = new Map(view.items.map((entry) => [entry.id, entry]));
  }

  private async loginCashier(): Promise<void> {
    // A cashier logs in on a computer the owner has used: the same device cookie.
    for (const [name, value] of this.owner.jar) {
      if (name.endsWith('device')) this.cashier.jar.set(name, value);
    }
    await this.cashier.ok('POST', '/login/staff', {
      username: DEMO_CASHIER_USERNAME,
      password: DEMO_PASSWORD,
    });
  }

  // ---- One day ----

  private async moveTo(instant: number): Promise<void> {
    // Neither session may look idle while the other one is busy: every 20 minutes of the
    // shop's day, both send "still here" (the web app does the same on a key press).
    while (instant - this.lastPing > HOP_MS) {
      this.clock.time = this.lastPing + HOP_MS;
      await this.owner.ok('POST', '/session/active');
      await this.cashier.ok('POST', '/session/active');
      this.lastPing = this.clock.time;
    }
    this.clock.time = instant;
  }

  private async runDay(date: string, index: number): Promise<void> {
    // A new morning: both log in again, replacing yesterday's sessions.
    this.clock.time = istInstant(date, 7, 55);
    this.lastPing = this.clock.time;
    await this.owner.ok('POST', '/login', { email: this.email, password: DEMO_PASSWORD });
    await this.cashier.ok('POST', '/login/staff', {
      username: DEMO_CASHIER_USERNAME,
      password: DEMO_PASSWORD,
    });

    const count = billsForDay(date, this.random);
    const times = Array.from({ length: count }, () => this.billTime(date)).sort((a, b) => a - b);
    const events = [
      ...times.map((time) => ({ time, kind: 'bill' as const })),
      ...this.paymentsOn(date).map((time) => ({ time, kind: 'payment' as const })),
      ...(ADJUSTMENT_DAYS.includes(index)
        ? [{ time: istInstant(date, 20, 40), kind: 'adjust' as const }]
        : []),
      ...(weekday(date) === 1 || weekday(date) === 4
        ? [{ time: istInstant(date, 11, 15), kind: 'business' as const }]
        : []),
    ].sort((a, b) => a.time - b.time);

    for (const event of events) {
      await this.moveTo(event.time);
      if (event.kind === 'bill') await this.sellOne(date);
      else if (event.kind === 'payment') await this.takePayments(date);
      else if (event.kind === 'adjust') await this.adjustStock(index);
      else await this.sellToBusiness();
    }
  }

  private billTime(date: string): number {
    const [hour] = this.random.weighted(HOUR_WEIGHTS, ([, weight]) => weight);
    return istInstant(date, hour, this.random.int(0, 59));
  }

  /** Customers who pay a little on some days: only those that pay regularly, about fortnightly. */
  private paymentsOn(date: string): number[] {
    const times: number[] = [];
    for (const customer of this.shop.customers) {
      if (customer.demo.udhaar !== 'pays_regularly' || customer.balance <= 0) continue;
      const due =
        this.nextPayment.get(customer.id) ?? addDays(this.firstDay, this.random.int(6, 14));
      this.nextPayment.set(customer.id, due);
      if (date >= due)
        times.push(istInstant(date, this.random.int(10, 19), this.random.int(0, 59)));
    }
    return times;
  }

  private async takePayments(date: string): Promise<void> {
    for (const customer of this.shop.customers) {
      const due = this.nextPayment.get(customer.id);
      if (customer.demo.udhaar !== 'pays_regularly' || due === undefined || date < due) continue;
      if (customer.balance <= 0) continue;
      // Between a third and everything, in whole tens of rupees.
      const share = this.random.int(35, 100) / 100;
      const amountPaise = Math.max(
        1_000,
        Math.min(customer.balance, Math.round((customer.balance * share) / 1_000) * 1_000),
      );
      await this.owner.ok('POST', '/udhaar/payments', {
        requestKey: this.random.uuid(),
        customerId: customer.id,
        amountPaise,
        mode: this.random.chance(0.6) ? 'upi' : 'cash',
      });
      customer.balance -= amountPaise;
      customer.lastPaidOn = date;
      this.udhaarPayments += 1;
      this.nextPayment.set(customer.id, addDays(date, this.random.int(10, 16)));
    }
  }

  /** A few write-offs and a recount, as a real shop has (`01` #11). */
  private async adjustStock(index: number): Promise<void> {
    const named = (name: string) => this.shop.items.find(({ demo }) => demo.name === name);
    const plan: [string, number, 'damaged' | 'expired' | 'count_mismatch', string | null][] = [
      ['Bread Loaf', -4_000, 'expired', 'Past the date on the wrapper'],
      ['Toned Milk 500 ml', -3_000, 'expired', null],
      ['Crunchy Glucose Biscuits 100 g', -6_000, 'damaged', 'Box got wet'],
      ['Sugar', -2_500, 'count_mismatch', 'Counted on the shelf'],
    ];
    const chosen = plan[ADJUSTMENT_DAYS.indexOf(index) % plan.length];
    if (chosen === undefined) return;
    const [name, quantity, reason, note] = chosen;
    const item = named(name);
    if (item === undefined) return;
    const left = this.stock.get(name) ?? 0;
    if (left + quantity < 0) return;
    await this.owner.ok('POST', `/items/${item.id}/stock/adjustments`, {
      quantity,
      reason,
      note,
      requestKey: this.random.uuid(),
    });
    this.stock.set(name, left + quantity);
    this.stockAdjustments += 1;
  }

  // ---- One bill ----

  /** A counter sale: walk-in or a known customer, cash, UPI or udhaar. */
  private async sellOne(date: string): Promise<void> {
    const random = this.random;
    const customer = this.pickCustomer();
    const lines = this.pickLines(
      random.weighted([1, 2, 3, 4, 5, 6], (n) => [30, 30, 20, 10, 6, 4][n - 1] ?? 1),
    );
    if (customer !== null && random.chance(0.06)) lines.push(this.deliveryLine());
    if (lines.length === 0) return;

    const input = this.price(lines);
    const total = calculateBill(input).grandTotalPaise;
    const payments = this.payFor(total, customer);
    // Only the owner gives udhaar by default (`03` #10); the cashier is off on Sundays.
    const udhaar = payments.some((payment) => payment.mode === 'udhaar');
    const cashierWorks = weekday(date) !== STAFF.cashier.weeklyOffDay;
    const byCashier = !udhaar && cashierWorks && random.chance(0.55);
    // A discount above a cashier's limit needs the owner, so only the owner gives one.
    const discount = !byCashier && !udhaar && random.chance(0.05);
    await this.save(
      byCashier ? this.cashier : this.owner,
      lines,
      customer?.id ?? null,
      payments,
      discount,
    );
    if (udhaar && customer !== null) {
      customer.balance += payments.find((payment) => payment.mode === 'udhaar')?.amountPaise ?? 0;
    }
  }

  /** The Monday and Thursday order of the tiffin centre: big, with a GSTIN on the invoice. */
  private async sellToBusiness(): Promise<void> {
    const lines = this.pickLines(this.random.int(5, 7), true);
    if (lines.length === 0) return;
    const total = calculateBill(this.price(lines)).grandTotalPaise;
    await this.save(this.owner, lines, this.shop.businessCustomerId, [
      { mode: 'upi', amountPaise: total },
    ]);
  }

  private pickCustomer(): Shop['customers'][number] | null {
    if (!this.random.chance(0.35)) return null;
    return this.random.weighted(this.shop.customers, (customer) => customer.demo.weight);
  }

  /** `count` different items, each in a quantity a shopper would ask for. */
  private pickLines(count: number, big = false): Line[] {
    const random = this.random;
    const lines: Line[] = [];
    const used = new Set<string>();
    for (let attempt = 0; lines.length < count && attempt < count * 4; attempt += 1) {
      const entry = random.weighted(this.shop.items, ({ demo }) => demo.popularity);
      if (used.has(entry.id)) continue;
      const item = this.catalogue.get(entry.id);
      if (item === undefined || item.archived) continue;
      const left = this.stock.get(entry.demo.name) ?? 0;
      let packId: string | null = null;
      let quantity: number;
      let stock: number;
      if (
        entry.demo.pack !== undefined &&
        entry.packId !== null &&
        random.chance(big ? 0.5 : 0.04)
      ) {
        packId = entry.packId;
        quantity = random.int(1, big ? 3 : 1) * 1_000;
        stock = (quantity / 1_000) * entry.demo.pack.size;
      } else if (entry.demo.loose) {
        quantity = random.pick(
          big
            ? [5_000, 10_000, 15_000, 25_000]
            : [250, 500, 500, 750, 1_000, 1_000, 1_500, 2_000, 3_000],
        );
        stock = quantity;
      } else {
        quantity = random.int(1, big ? 12 : 3) * 1_000;
        stock = quantity;
      }
      // Never sell what the shelf doesn't have: the demo shows no negative stock.
      if (stock > left) continue;
      used.add(entry.id);
      this.stock.set(entry.demo.name, left - stock);
      lines.push({ item, demo: entry.demo, packId, quantityThousandths: quantity, stock });
    }
    return lines;
  }

  private deliveryLine(): Line {
    const item = this.catalogue.get(this.shop.serviceId);
    if (item === undefined || item.archived) throw new Error('The delivery service is missing');
    return { item, demo: null, packId: null, quantityThousandths: 1_000, stock: 0 };
  }

  private cartLines(lines: Line[], discount = false): CartLine[] {
    return lines.map((line, index) => ({
      itemId: line.item.id,
      packId: line.packId,
      quantityThousandths: line.quantityThousandths,
      shownUnitPricePaise: linePrice(line.item, line.packId, 'retail'),
      ...(discount && index === 0 && { discount: { kind: 'percent' as const, basisPoints: 500 } }),
    }));
  }

  private price(lines: Line[], discount = false) {
    return cartToBillInput(
      {
        priceList: 'retail',
        placeOfSupplyStateCode: SHOP.stateCode,
        lines: this.cartLines(lines, discount),
      },
      { scheme: 'regular', supplierStateCode: SHOP.stateCode, catalogue: this.catalogue },
    );
  }

  /** How the customer pays: mostly cash and UPI; some bills of udhaar customers go on the account. */
  private payFor(total: number, customer: Shop['customers'][number] | null): BillDraft['payments'] {
    const random = this.random;
    if (
      customer !== null &&
      customer.demo.udhaar !== 'none' &&
      customer.demo.creditLimit !== null
    ) {
      const goesOnAccount = random.chance(customer.demo.udhaar === 'overdue' ? 0.7 : 0.35);
      if (goesOnAccount && customer.balance + total <= customer.demo.creditLimit) {
        return [{ mode: 'udhaar', amountPaise: total }];
      }
    }
    const roll = random.next();
    if (roll < 0.55) {
      // Often the customer hands over a round note and gets change.
      const tendered = random.chance(0.5) ? Math.ceil(total / 5_000) * 5_000 : undefined;
      return [
        {
          mode: 'cash' as const,
          amountPaise: total,
          ...(tendered !== undefined && tendered >= total && { tenderedPaise: tendered }),
        },
      ];
    }
    if (roll < 0.93) return [{ mode: 'upi', amountPaise: total }];
    if (roll < 0.97 || total < 20_000) return [{ mode: 'card', amountPaise: total }];
    const cash = Math.round(total / 2 / 100) * 100;
    return [
      { mode: 'cash', amountPaise: cash },
      { mode: 'upi', amountPaise: total - cash },
    ];
  }

  private async save(
    client: SeedClient,
    lines: Line[],
    customerId: string | null,
    payments: BillDraft['payments'],
    discount = false,
  ): Promise<void> {
    // A discount changes the total, so the payments are worked out again for it.
    const input = this.price(lines, discount);
    const total = calculateBill(input).grandTotalPaise;
    const paid = discount ? this.rescale(payments, total) : payments;
    const draft: BillDraft = {
      billKey: this.random.uuid(),
      priceList: 'retail',
      customerId,
      placeOfSupplyStateCode: SHOP.stateCode,
      lines: this.cartLines(lines, discount),
      payments: paid,
      shownGrandTotalPaise: total,
    };
    const saved = await client.ok<{ grandTotalPaise: number }>('POST', '/bills', draft);
    this.bills += 1;
    this.billedPaise += saved.grandTotalPaise;
  }

  /** The same payment methods for a new total: the last one takes the difference. */
  private rescale(payments: BillDraft['payments'], total: number): BillDraft['payments'] {
    const [first] = payments;
    if (first === undefined) return payments;
    return [{ mode: first.mode, amountPaise: total }];
  }
}

/** Days (counted from the first) when the owner writes something off or recounts. */
const ADJUSTMENT_DAYS = [9, 17, 26, 34];
