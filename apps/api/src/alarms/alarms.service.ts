import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";

import { alarms, assets, auditLog, users } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { AlarmListItem, JwtPayload } from "@bms/shared";

import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant } from "../database/tenant-context";
import { withReadScope } from "../database/tenant-read-scope";
import { AlarmsGateway } from "./alarms.gateway";

function encodeCursor(raisedAt: Date, id: string): string {
  return Buffer.from(
    JSON.stringify({ t: raisedAt.toISOString(), id }),
    "utf-8",
  ).toString("base64url");
}

function decodeCursor(raw: string): { raisedAt: Date; id: string } {
  const j = JSON.parse(
    Buffer.from(raw, "base64url").toString("utf-8"),
  ) as { t: string; id: string };
  return { raisedAt: new Date(j.t), id: j.id };
}

@Injectable()
export class AlarmsService {
  constructor(
    @Inject(TENANT_DRIZZLE) private readonly db: BmsDb,
    // E7.1b (ADR 0043 decisions 1+3): `list` reads `alarms` — a decision-1
    // tenant-data table — through `withReadScope`. A single-organization actor
    // is served inside `withTenant`, so the 0047 FORCE policy scopes the read
    // (decision 1, the RLS backstop); an admin or multi-organization actor falls
    // back to `fleetDb` at run time (decisions 2/3), where the `assetIds` WHERE
    // filter is the isolation control and the keyset `(raised_at, id)` cursor
    // survives — the per-org loop was considered and rejected. `resolveAlarmOrg`
    // (write-path org resolution for `acknowledge`) and the pre-tenant actor
    // read stay on `fleetDb`; the acknowledge read-back already runs inside the
    // write's tenant transaction.
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    private readonly gateway: AlarmsGateway,
  ) {}

  /**
   * The organization an alarm belongs to (`alarms.organization_id`, 0046 =
   * `asset_id → assets.org`), read on fleetDb behind the caller's scope. The
   * `acknowledge` write is wrapped in this org's GUC.
   */
  private async resolveAlarmOrg(
    alarmId: string,
    assetIds?: string[] | null,
  ): Promise<string> {
    const [row] = await this.fleetDb
      .select({ organizationId: alarms.organizationId })
      .from(alarms)
      .where(
        and(
          eq(alarms.id, alarmId),
          ...(assetIds ? [inArray(alarms.assetId, assetIds)] : []),
        ),
      )
      .limit(1);
    if (!row) {
      throw new NotFoundException("Alarm not found or outside your access scope");
    }
    if (!row.organizationId) {
      throw new BadRequestException("Alarm has no organization; run the 0046 backfill");
    }
    return row.organizationId;
  }

  private mapRow(r: {
    id: string;
    assetId: string;
    ruleKey: string | null;
    ruleId: string | null;
    severity: string;
    message: string;
    raisedAt: Date;
    acknowledgedAt: Date | null;
    acknowledgedBy: string | null;
    assetCode: string;
    assetName: string;
    siteName: string;
  }): AlarmListItem {
    return {
      id: r.id,
      assetId: r.assetId,
      ruleKey: r.ruleKey,
      ruleId: r.ruleId,
      severity: r.severity,
      message: r.message,
      raisedAt: r.raisedAt.toISOString(),
      acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
      acknowledgedBy: r.acknowledgedBy,
      assetCode: r.assetCode,
      assetName: r.assetName,
      siteName: r.siteName,
    };
  }

  /**
   * Keyset pagination on `(raised_at DESC, id DESC)`.
   */
  async list(opts: {
    cursor?: string;
    limit: number;
    assetIds?: string[] | null;
  }): Promise<{ items: AlarmListItem[]; nextCursor: string | null }> {
    const limit = Math.min(100, Math.max(1, opts.limit));
    const cursor = opts.cursor;
    const filters = opts.assetIds ? [inArray(alarms.assetId, opts.assetIds)] : [];

    return withReadScope(
      this.db,
      this.fleetDb,
      opts.assetIds,
      () => ({ items: [], nextCursor: null }),
      async (tx) => {
        const base = tx
          .select({
            id: alarms.id,
            assetId: alarms.assetId,
            ruleKey: alarms.ruleKey,
            ruleId: alarms.ruleId,
            severity: alarms.severity,
            message: alarms.message,
            raisedAt: alarms.raisedAt,
            acknowledgedAt: alarms.acknowledgedAt,
            acknowledgedBy: alarms.acknowledgedBy,
            assetCode: assets.code,
            assetName: assets.name,
            siteName: assets.siteName,
          })
          .from(alarms)
          .innerJoin(assets, eq(alarms.assetId, assets.id));

        const c = cursor ? decodeCursor(cursor) : null;
        const cursorFilter = c
          ? or(
              lt(alarms.raisedAt, c.raisedAt),
              and(eq(alarms.raisedAt, c.raisedAt), lt(alarms.id, c.id)),
            )
          : undefined;
        const whereFilter =
          cursorFilter && filters.length > 0
            ? and(...filters, cursorFilter)
            : cursorFilter
              ? cursorFilter
              : filters.length > 0
                ? and(...filters)
                : undefined;
        const rows = await (c
          ? base
              .where(whereFilter)
              .orderBy(desc(alarms.raisedAt), desc(alarms.id))
              .limit(limit + 1)
          : whereFilter
            ? base
                .where(whereFilter)
                .orderBy(desc(alarms.raisedAt), desc(alarms.id))
                .limit(limit + 1)
            : base.orderBy(desc(alarms.raisedAt), desc(alarms.id)).limit(limit + 1));

        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const last = page[page.length - 1];
        const nextCursor = hasMore && last ? encodeCursor(last.raisedAt, last.id) : null;

        return {
          items: page.map((r) => this.mapRow(r)),
          nextCursor,
        };
      },
    );
  }

  /**
   * Acknowledges an alarm and writes a lightweight audit row.
   */
  async acknowledge(
    alarmId: string,
    actor: Pick<JwtPayload, "sub" | "email">,
    reason: string,
    assetIds?: string[] | null,
  ): Promise<AlarmListItem> {
    if (assetIds && assetIds.length === 0) {
      throw new NotFoundException("Alarm not found or outside your access scope");
    }
    const [actorRow] = await this.fleetDb
      .select({ id: users.id })
      .from(users)
      .where(or(eq(users.id, actor.sub), eq(users.email, actor.email)))
      .limit(1);
    const dbActorId = actorRow?.id ?? null;

    const organizationId = await this.resolveAlarmOrg(alarmId, assetIds);

    return withTenant(this.db, organizationId, async (tx) => {
      const updated = await tx
        .update(alarms)
        .set({
          acknowledgedAt: new Date(),
          acknowledgedBy: dbActorId,
        })
        .where(
          and(
            eq(alarms.id, alarmId),
            isNull(alarms.acknowledgedAt),
            ...(assetIds ? [inArray(alarms.assetId, assetIds)] : []),
          ),
        )
        .returning({ id: alarms.id });

      if (updated.length === 0) {
        throw new NotFoundException("Alarm not found or already acknowledged");
      }

      await tx.insert(auditLog).values({
        organizationId,
        actorId: dbActorId,
        action: "alarm_ack",
        entityType: "alarm",
        entityId: alarmId,
        reason,
        payload: {
          alarmId,
          oidcSubject: actor.sub,
          actorEmail: actor.email,
        },
      });

      const [row] = await tx
        .select({
          id: alarms.id,
          assetId: alarms.assetId,
          ruleKey: alarms.ruleKey,
          ruleId: alarms.ruleId,
          severity: alarms.severity,
          message: alarms.message,
          raisedAt: alarms.raisedAt,
          acknowledgedAt: alarms.acknowledgedAt,
          acknowledgedBy: alarms.acknowledgedBy,
          assetCode: assets.code,
          assetName: assets.name,
          siteName: assets.siteName,
        })
        .from(alarms)
        .innerJoin(assets, eq(alarms.assetId, assets.id))
        .where(eq(alarms.id, alarmId))
        .limit(1);

      if (!row) {
        throw new NotFoundException("Alarm vanished after update");
      }

      const item = this.mapRow(row);
      this.gateway.broadcastAcknowledged(item);
      return item;
    });
  }
}
