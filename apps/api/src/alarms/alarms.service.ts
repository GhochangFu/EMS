import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { alarms, alarmSeverities, assets, auditLog, users } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type {
  AlarmListItem,
  AlarmSeverityCount,
  AlarmSummaryResponse,
  JwtPayload,
} from "@bms/shared";

import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant } from "../database/tenant-context";
import { withReadScope } from "../database/tenant-read-scope";
import { activeAlarmFilter } from "./active-alarm-filter";
import { alarmListItemColumns, toAlarmListItem } from "./alarm-list-item";
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

  /**
   * Keyset pagination on `(raised_at DESC, id DESC)`.
   *
   * `F3.28` (ADR 0074 decision 4): `state: "active"` keeps only rows matching
   * `activeAlarmFilter` (`cleared_at IS NULL`); absent or `"all"` is today's
   * read, unchanged. `assetIds` is the caller's already-narrowed scope — the
   * controller intersects a requested filter with `readableAssetIds` before it
   * reaches here, so this method never sees an id the caller cannot read.
   *
   * `F3.66` (step-5 fix): `organizationId` keeps only alarms whose asset
   * belongs to that organization (`assets.organization_id`, NOT NULL since
   * 0047 — not `alarms.organization_id`). It is ANDed onto `assetIds`, never
   * a replacement for it, so it can only narrow the caller's scope.
   */
  async list(opts: {
    cursor?: string;
    limit: number;
    assetIds?: string[] | null;
    state?: "all" | "active";
    organizationId?: string;
  }): Promise<{ items: AlarmListItem[]; nextCursor: string | null }> {
    // Truncated after the clamp (plan decision 4): the schema lets a fractional
    // `limit` through, as the old `Number(limitRaw)` did, and SQL's `LIMIT`
    // must never see one — `50.5` asks for 50 rows.
    const limit = Math.trunc(Math.min(100, Math.max(1, opts.limit)));
    const cursor = opts.cursor;
    const filters = [
      ...(opts.assetIds ? [inArray(alarms.assetId, opts.assetIds)] : []),
      ...(opts.state === "active" ? [activeAlarmFilter] : []),
      // The list inner-joins `assets`, so the organization is the joined row's.
      ...(opts.organizationId ? [eq(assets.organizationId, opts.organizationId)] : []),
    ];

    return withReadScope(
      this.db,
      this.fleetDb,
      opts.assetIds,
      () => ({ items: [], nextCursor: null }),
      async (tx) => {
        const base = tx
          .select(alarmListItemColumns)
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
          items: page.map((r) => toAlarmListItem(r)),
          nextCursor,
        };
      },
    );
  }

  /**
   * `F3.28` (ADR 0074 decision 4, plan decision 7) — active alarm counts per
   * severity for the alarms rail's summary tab.
   *
   * Every **active** severity is a row, in ascending `rank` order (the
   * `GET /vocabularies` order), with its count — zero allowed — so the rail
   * never has to invent a missing level. `bms.alarm_severities LEFT JOIN
   * bms.alarms`: the active predicate and the scope predicate both sit in the
   * `ON` clause, not in `WHERE`, so a severity with no matching alarm keeps its
   * row, and `count(alarms.id)` (never `count(*)`) counts it as 0.
   *
   * `assetIds` is the caller's already-narrowed scope, routed through
   * `withReadScope` like `list`. On the fleet path (an admin, or a scope
   * spanning organizations) the `inArray` in the `ON` clause is the only
   * isolation control. An empty scope — `[]`, or ids that resolve to no
   * asset — never reads `bms.alarms`: it returns every active severity at 0.
   *
   * `F3.66` (step-5 fix): `organizationId` adds a second `ON` predicate —
   * the alarm's asset is one of that organization's assets — ANDed onto the
   * scope predicate, so it only narrows.
   */
  async activeCountsBySeverity(
    assetIds: string[] | null | undefined,
    organizationId?: string,
  ): Promise<AlarmSummaryResponse> {
    const severityColumns = {
      code: alarmSeverities.code,
      label: alarmSeverities.label,
      tone: alarmSeverities.tone,
      rank: alarmSeverities.rank,
    };
    // `tone` is closed by `alarm_severities_tone_check` in SQL, so the
    // column's `string` is narrowed to the contract's palette here.
    const toCount = (r: { code: string; label: string; tone: string; rank: number; count: number }) =>
      ({ ...r, tone: r.tone as AlarmSeverityCount["tone"] }) satisfies AlarmSeverityCount;

    const counted = await withReadScope(
      this.db,
      this.fleetDb,
      assetIds,
      () => null,
      (tx) =>
        tx
          .select({
            ...severityColumns,
            count: sql<number>`count(${alarms.id})::int`,
          })
          .from(alarmSeverities)
          .leftJoin(
            alarms,
            and(
              eq(alarms.severity, alarmSeverities.code),
              activeAlarmFilter,
              ...(assetIds ? [inArray(alarms.assetId, assetIds)] : []),
              ...(organizationId
                ? [
                    inArray(
                      alarms.assetId,
                      tx
                        .select({ id: assets.id })
                        .from(assets)
                        .where(eq(assets.organizationId, organizationId)),
                    ),
                  ]
                : []),
            ),
          )
          .where(eq(alarmSeverities.active, true))
          .groupBy(
            alarmSeverities.code,
            alarmSeverities.label,
            alarmSeverities.tone,
            alarmSeverities.rank,
          )
          .orderBy(asc(alarmSeverities.rank)),
    );
    const rows =
      counted ??
      (
        await this.fleetDb
          .select(severityColumns)
          .from(alarmSeverities)
          .where(eq(alarmSeverities.active, true))
          .orderBy(asc(alarmSeverities.rank))
      ).map((s) => ({ ...s, count: 0 }));
    const items = rows.map(toCount);
    return { items, total: items.reduce((sum, i) => sum + i.count, 0) };
  }

  /**
   * Acknowledges an alarm and writes a lightweight audit row.
   *
   * `F3.10` / ADR 0057 decision 1: this never writes `cleared_at`. The filter
   * below stays `acknowledged_at IS NULL` *only* — a cleared, unacknowledged
   * alarm is still acknowledgeable, and that press is the transition to
   * *closed*. Adding a `cleared_at IS NULL` filter here would strand every
   * swept alarm in the alarm centre for ever.
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
        .select(alarmListItemColumns)
        .from(alarms)
        .innerJoin(assets, eq(alarms.assetId, assets.id))
        .where(eq(alarms.id, alarmId))
        .limit(1);

      if (!row) {
        throw new NotFoundException("Alarm vanished after update");
      }

      const item = toAlarmListItem(row);
      this.gateway.broadcastAcknowledged(item);
      return item;
    });
  }
}
