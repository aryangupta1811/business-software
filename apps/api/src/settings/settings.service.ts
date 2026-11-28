import { ConflictException, Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  branches,
  businesses,
  eq,
  invoiceCounters,
  recordEntry,
  users,
  withBusiness,
  type Database,
  type EntryAction,
  type Transaction,
} from '@business-software/db';
import { businessDate, financialYear } from '@business-software/shared';
import type {
  AlertType,
  BusinessType,
  Feature,
  GstStatus,
  SettingsAlertsInput,
  SettingsBusinessInput,
  SettingsFeaturesInput,
  SettingsInvoicesInput,
  SettingsSecurityInput,
  SettingsStockInput,
  SettingsUdhaarInput,
  OverCreditLimitSetting,
  SettingsView,
  NegativeStockSetting,
  BranchStateCode,
} from '@business-software/shared';
import { DATABASE } from '../database.module.js';
import { refuseInDemo } from '../demo/demo-rules.js';
import type { Caller } from '../http/session.js';

type Section = Record<string, unknown>;

interface Current {
  view: SettingsView;
  branchId: string;
  ownerId: string;
}

/** The keys whose values differ, as `before` and `after` objects (arrays compared by value). */
function changes(before: Section, after: Section): { before: Section; after: Section } | null {
  const keys = Object.keys(after).filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
  if (keys.length === 0) return null;
  return {
    before: Object.fromEntries(keys.map((key) => [key, before[key]])),
    after: Object.fromEntries(keys.map((key) => [key, after[key]])),
  };
}

/**
 * Module 00 #8, #10, #21, #29. Each save is one transaction that locks the business row, so two
 * counters saving at once are applied one after the other and each log entry is exact.
 * Old bills keep their own copy of these details (#11, P1.14), so editing here is safe.
 */
@Injectable()
export class SettingsService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  read(caller: Caller): Promise<SettingsView> {
    return withBusiness(this.database.db, caller.businessId, async (tx) => {
      return (await this.load(tx, caller, false)).view;
    });
  }

  saveBusiness(caller: Caller, input: SettingsBusinessInput): Promise<SettingsView> {
    return this.save(
      caller,
      (current) => current.view.business,
      input,
      async (tx, current) => {
        // What kind of shop the demo is, and whether it charges GST, stay as they are.
        const was = current.view.business;
        if (was.businessType !== input.businessType || was.gstStatus !== input.gstStatus) {
          await refuseInDemo(tx);
        }
        await tx
          .update(businesses)
          .set({
            name: input.businessName,
            businessType: input.businessType,
            phone: input.phone,
            gstStatus: input.gstStatus,
            pan: input.pan,
            updatedAt: new Date(),
          })
          .where(eq(businesses.id, caller.businessId));
        await tx
          .update(branches)
          .set({
            name: input.branchName,
            address: input.address,
            pinCode: input.pinCode,
            stateCode: input.stateCode,
            gstin: input.gstin,
            drugLicence: input.drugLicence,
            fssai: input.fssai,
            updatedAt: new Date(),
          })
          .where(eq(branches.id, current.branchId));
        await tx.update(users).set({ name: input.ownerName }).where(eq(users.id, current.ownerId));
      },
    );
  }

  saveFeatures(caller: Caller, input: SettingsFeaturesInput): Promise<SettingsView> {
    return this.save(
      caller,
      (current) => ({ features: current.view.features }),
      input,
      (tx) =>
        tx
          .update(businesses)
          .set({ features: input.features, updatedAt: new Date() })
          .where(eq(businesses.id, caller.businessId)),
    );
  }

  saveSecurity(caller: Caller, input: SettingsSecurityInput): Promise<SettingsView> {
    return this.save(
      caller,
      (current) => current.view.security,
      input,
      (tx) =>
        tx
          .update(businesses)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(businesses.id, caller.businessId)),
    );
  }

  /** Module 01 #12 (owner answer 1A): one switch for the whole business. */
  saveStock(caller: Caller, input: SettingsStockInput): Promise<SettingsView> {
    return this.save(
      caller,
      (current) => current.view.stock,
      input,
      (tx) =>
        tx
          .update(businesses)
          .set({ negativeStock: input.negativeStock, updatedAt: new Date() })
          .where(eq(businesses.id, caller.businessId)),
    );
  }

  /** `03` #9: past a credit limit the owner is warned, or needs their own password. */
  saveUdhaar(caller: Caller, input: SettingsUdhaarInput): Promise<SettingsView> {
    return this.save(
      caller,
      (current) => current.view.udhaar,
      input,
      (tx) =>
        tx
          .update(businesses)
          .set({ overCreditLimit: input.overCreditLimit, updatedAt: new Date() })
          .where(eq(businesses.id, caller.businessId)),
    );
  }

  /**
   * Module 07 #3: the types the bell shows. A type switched off still records its alerts;
   * only what the app shows changes, so nothing is lost by switching one off.
   */
  saveAlerts(caller: Caller, input: SettingsAlertsInput): Promise<SettingsView> {
    return this.save(
      caller,
      (current) => current.view.alerts,
      input,
      (tx) =>
        tx
          .update(businesses)
          .set({ alertTypes: input.types, updatedAt: new Date() })
          .where(eq(businesses.id, caller.businessId)),
      'settings.alerts_changed',
    );
  }

  /**
   * `00` #61: the prefix of a one-branch business's invoice numbers. Saved bills keep the
   * numbers they were given, so changing it renumbers nothing. A prefix that is a branch's code
   * (archived ones too) is refused: once there are two branches the code starts the number, so
   * the two would hand out the same numbers.
   */
  saveInvoices(caller: Caller, input: SettingsInvoicesInput): Promise<SettingsView> {
    return this.save(
      caller,
      (current) => current.view.invoices,
      input,
      async (tx) => {
        await refuseInDemo(tx);
        if (input.invoicePrefix !== null) {
          const [clash] = await tx
            .select({ id: branches.id })
            .from(branches)
            .where(eq(branches.code, input.invoicePrefix));
          if (clash !== undefined) throw new ConflictException({ code: 'prefix_is_branch_code' });
        }
        await tx
          .update(businesses)
          .set({ invoicePrefix: input.invoicePrefix, updatedAt: new Date() })
          .where(eq(businesses.id, caller.businessId));
      },
    );
  }

  /** Locks, compares, writes and logs `action` with only the changed fields. */
  private save(
    caller: Caller,
    section: (current: Current) => Section,
    input: Section,
    write: (tx: Transaction, current: Current) => Promise<unknown>,
    action: EntryAction = 'business.updated',
  ): Promise<SettingsView> {
    return withBusiness(this.database.db, caller.businessId, async (tx) => {
      const current = await this.load(tx, caller, true);
      const changed = changes(section(current), input);
      if (changed === null) return current.view;
      await write(tx, current);
      await recordEntry(tx, {
        actorId: caller.userId,
        action,
        entityType: 'business',
        entityId: caller.businessId,
        ...changed,
      });
      return (await this.load(tx, caller, false)).view;
    });
  }

  private async load(tx: Transaction, caller: Caller, lock: boolean): Promise<Current> {
    const query = tx.select().from(businesses).where(eq(businesses.id, caller.businessId));
    const [business] = lock ? await query.for('update') : await query;
    // The business details are the head office's: the oldest branch (P1.6), which is never
    // archived. Other branches are edited on their own card.
    const [branch] = await tx
      .select()
      .from(branches)
      .orderBy(asc(branches.createdAt), asc(branches.id))
      .limit(1);
    const [owner] = await tx
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.role, 'owner'));
    if (business === undefined || branch === undefined || owner === undefined) {
      throw new Error('Business, head office or owner not found');
    }
    // The counter holds the last number given; no row yet means the next number is 1.
    const year = financialYear(businessDate(new Date()));
    const [counter] = await tx
      .select({ lastNumber: invoiceCounters.lastNumber })
      .from(invoiceCounters)
      .where(
        and(eq(invoiceCounters.branchId, caller.branchId), eq(invoiceCounters.financialYear, year)),
      );
    return {
      branchId: branch.id,
      ownerId: owner.id,
      view: {
        business: {
          businessName: business.name,
          businessType: business.businessType as BusinessType,
          phone: business.phone,
          gstStatus: business.gstStatus as GstStatus,
          pan: business.pan,
          ownerName: owner.name,
          branchName: branch.name,
          address: branch.address,
          pinCode: branch.pinCode,
          stateCode: branch.stateCode as BranchStateCode,
          gstin: branch.gstin,
          drugLicence: branch.drugLicence,
          fssai: branch.fssai,
        },
        features: business.features as Feature[],
        security: {
          ownerLockMinutes: business.ownerLockMinutes,
          staffIdleMinutes: business.staffIdleMinutes,
        },
        stock: { negativeStock: business.negativeStock as NegativeStockSetting },
        alerts: { types: business.alertTypes as AlertType[] },
        invoices: { invoicePrefix: business.invoicePrefix },
        udhaar: { overCreditLimit: business.overCreditLimit as OverCreditLimitSetting },
        nextInvoice: { financialYear: year, sequence: (counter?.lastNumber ?? 0) + 1 },
      },
    };
  }
}
