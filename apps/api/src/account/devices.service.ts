// Remembered computers (Module 00 #44): Settings lists them, renames them and forgets them.
// Forgetting, and moving a computer to another branch (P1.6), need the owner's password (section
// 6); a forgotten row is kept with `revoked_at`, and every session open on that computer ends.
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  and,
  asc,
  branches,
  devices,
  eq,
  isNull,
  recordEntry,
  sessions,
  withBusiness,
  type Database,
  type Transaction,
} from '@business-software/db';
import type { DeviceView } from '@business-software/shared';
import { CLOCK, type Clock } from '../auth/clock.js';
import {
  SESSION_SERVICE,
  type RequestContext,
  type SessionService,
} from '../auth/session.service.js';
import { DATABASE } from '../database.module.js';
import type { Caller } from '../http/session.js';

@Injectable()
export class DevicesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** The business's remembered computers, oldest first; "This computer" is marked. */
  list(caller: Caller, context: RequestContext): Promise<DeviceView[]> {
    const mine = this.sessions.deviceTokenHashOf(context);
    return withBusiness(this.database.db, caller.businessId, (tx) => this.viewsIn(tx, mine));
  }

  async rename(
    caller: Caller,
    id: string,
    name: string,
    context: RequestContext,
  ): Promise<DeviceView> {
    const mine = this.sessions.deviceTokenHashOf(context);
    return withBusiness(this.database.db, caller.businessId, async (tx) => {
      const [before] = await tx
        .select({ name: devices.name })
        .from(devices)
        .where(and(eq(devices.id, id), isNull(devices.revokedAt)));
      if (before === undefined) throw new NotFoundException({ code: 'not_found' });
      await tx.update(devices).set({ name }).where(eq(devices.id, id));
      await recordEntry(tx, {
        actorId: caller.userId,
        action: 'device.renamed',
        entityType: 'device',
        entityId: id,
        branchId: caller.branchId,
        before: { name: before.name },
        after: { name },
      });
      const view = (await this.viewsIn(tx, mine, id))[0];
      if (view === undefined) throw new Error('Renamed device not found');
      return view;
    });
  }

  /**
   * Forgets a computer: staff can't log in on it until the owner logs in there again, and its
   * open sessions end. Answers whether it was this computer, whose cookies then go too.
   */
  /**
   * Moves a computer to another branch (owner answer 3A): it decides where bills and stock go,
   * so it needs the owner's password. Sessions open on it end (they were started for the old
   * branch). The same branch again changes nothing. Answers whether that ended this browser's
   * own session, whose cookie then goes.
   */
  async move(
    caller: Caller,
    id: string,
    branchId: string,
    ownerPassword: string,
    context: RequestContext,
  ): Promise<{ device: DeviceView; endedOwnSession: boolean }> {
    await this.sessions.requireOwnerPassword(caller, ownerPassword);
    const mine = this.sessions.deviceTokenHashOf(context);
    return withBusiness(this.database.db, caller.businessId, async (tx) => {
      const [target] = await tx
        .select({ id: branches.id })
        .from(branches)
        .where(and(eq(branches.id, branchId), isNull(branches.archivedAt)))
        .for('share');
      if (target === undefined) {
        throw new BadRequestException({ code: 'invalid_body', fields: { branchId: 'invalid' } });
      }
      const [before] = await tx
        .select({ branchId: devices.branchId, tokenHash: devices.tokenHash })
        .from(devices)
        .where(and(eq(devices.id, id), isNull(devices.revokedAt)))
        .for('update');
      if (before === undefined) throw new NotFoundException({ code: 'not_found' });
      const moved = before.branchId !== branchId;
      if (moved) {
        await tx.update(devices).set({ branchId }).where(eq(devices.id, id));
        await this.sessions.endSessionsIn(tx, eq(sessions.deviceId, id), 'device_moved');
        await recordEntry(tx, {
          actorId: caller.userId,
          action: 'device.moved',
          entityType: 'device',
          entityId: id,
          branchId: caller.branchId,
          before: { branchId: before.branchId },
          after: { branchId },
        });
      }
      const device = (await this.viewsIn(tx, mine, id))[0];
      if (device === undefined) throw new Error('Moved device not found');
      return { device, endedOwnSession: moved && before.tokenHash === mine };
    });
  }

  async forget(
    caller: Caller,
    id: string,
    ownerPassword: string,
    context: RequestContext,
  ): Promise<{ thisComputer: boolean }> {
    await this.sessions.requireOwnerPassword(caller, ownerPassword);
    return withBusiness(this.database.db, caller.businessId, async (tx) => {
      const [revoked] = await tx
        .update(devices)
        .set({ revokedAt: this.clock.now() })
        .where(and(eq(devices.id, id), isNull(devices.revokedAt)))
        .returning({ tokenHash: devices.tokenHash });
      if (revoked === undefined) throw new NotFoundException({ code: 'not_found' });
      await this.sessions.endSessionsIn(tx, eq(sessions.deviceId, id), 'device_forgotten');
      await recordEntry(tx, {
        actorId: caller.userId,
        action: 'device.revoked',
        entityType: 'device',
        entityId: id,
        branchId: caller.branchId,
      });
      return { thisComputer: revoked.tokenHash === this.sessions.deviceTokenHashOf(context) };
    });
  }

  private async viewsIn(tx: Transaction, mine: string | null, id?: string): Promise<DeviceView[]> {
    const rows = await tx
      .select({
        id: devices.id,
        name: devices.name,
        branchId: branches.id,
        branchCode: branches.code,
        branchName: branches.name,
        createdAt: devices.createdAt,
        lastSeenAt: devices.lastSeenAt,
        tokenHash: devices.tokenHash,
      })
      .from(devices)
      .innerJoin(
        branches,
        and(eq(branches.businessId, devices.businessId), eq(branches.id, devices.branchId)),
      )
      .where(and(isNull(devices.revokedAt), id === undefined ? undefined : eq(devices.id, id)))
      .orderBy(asc(devices.createdAt), asc(devices.id));
    return rows.map(({ tokenHash, createdAt, lastSeenAt, ...row }) => ({
      ...row,
      createdAt: createdAt.toISOString(),
      lastSeenAt: lastSeenAt.toISOString(),
      thisComputer: tokenHash === mine,
    }));
  }
}
