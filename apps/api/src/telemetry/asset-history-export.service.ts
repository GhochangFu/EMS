import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Pool } from "pg";

import {
  type AggregateLevel,
  type JwtPayload,
  assetHistoryExportQuerySchema,
  parsePointsList,
} from "@bms/shared";

import { idParamSchema } from "../admin/admin.schema";
import { MAX_EXPORT_ROWS } from "../admin/audit/audit.limits";
import { AccessControlService } from "../auth/access-control.service";
import { FLEET_POOL } from "../database/database.tokens";
import {
  type HistoryExportPoint,
  type ViewExportRow,
  assertViewExportWithinCap,
  assetHistoryExportRows,
  viewExportCsv,
  viewExportXlsx,
} from "../reports/view-export.serialise";
import {
  expectedBucketCount,
  levelFor,
  resolveAggregateRange,
  windowBoundsFor,
} from "./point-aggregate-window";
import { TelemetryService } from "./telemetry.service";

/** The `aggregate` route's sentence: the export answers a foreign asset exactly as the read does. */
const OUTSIDE_SCOPE = "Asset is outside your access scope";

/** Names no code: the caller learns that one of its points is not on the asset, never which others are. */
export const POINT_NOT_REGISTERED = "A point in points is not registered on this asset";

/** The zone a response without `timeZone` is written in — the history page's own fallback. */
const FALLBACK_ZONE = "Etc/UTC";

/**
 * `F4.303` U5 (ADR 0108 Amendment 6 item 3; plan C4) — the rows the history
 * export can hold, before any telemetry statement: one per point per bucket the
 * window yields at the level it will be read at, per period.
 */
export function assetHistoryExportRowCount(
  points: number,
  windowMinutes: number,
  level: AggregateLevel,
  compare: boolean,
): number {
  return points * expectedBucketCount(windowMinutes, level) * (compare ? 2 : 1);
}

/**
 * `F4.303` U5 (ADR 0108 Amendment 6 item 3; plan C6) — the asset history page's
 * state as one file: `GET /telemetry/assets/:assetId/history/export.csv|.xlsx`.
 *
 * **The `aggregate` route's order, then the cap, then the read.** The asset id's
 * UUID shape (400 — `canReadAsset` answers a global admin without a lookup, so
 * nothing else stops a non-UUID id before the `uuid` column), `canReadAsset`
 * (403, once: every point is on the one asset), the query (400 with
 * `flatten()`), the asset's active registrations (a code it does not register is
 * a 404 that names no code), the row count over the resolved range (a 400 above
 * `MAX_EXPORT_ROWS`), and only then `pointAggregate` per point with
 * `bucketStats: true` — the history page's read, so the file and the screen show
 * one figure. `telemetry.*` carries no Row Level Security: every refusal runs
 * before the first telemetry statement.
 *
 * **One `now`.** The level the cap counts at is `levelFor` at `now`, and the same
 * `now` goes to every `pointAggregate`, so the read cannot pick a finer level than
 * the count assumed.
 *
 * The registration select runs on the fleet pool (`bms.asset_points` carries Row
 * Level Security and no organization context is set here); the `canReadAsset`
 * check before it is the containment, the `TelemetryService` zone-read precedent.
 */
@Injectable()
export class AssetHistoryExportService {
  constructor(
    private readonly telemetry: TelemetryService,
    private readonly accessControl: AccessControlService,
    @Inject(FLEET_POOL) private readonly fleetPool: Pool,
  ) {}

  /** `cap` and `now` are seams for the specs; the routes pass neither. */
  async exportRows(
    jwt: JwtPayload,
    assetId: string,
    query: unknown,
    now: Date = new Date(),
    cap: number = MAX_EXPORT_ROWS,
  ): Promise<ViewExportRow[]> {
    const id = idParamSchema.safeParse(assetId);
    if (!id.success) {
      throw new BadRequestException("Invalid asset id: not a UUID");
    }
    if (!(await this.accessControl.canReadAsset(jwt, id.data))) {
      throw new ForbiddenException(OUTSIDE_SCOPE);
    }
    const parsed = assetHistoryExportQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    const { compare, bucketFunction } = parsed.data;
    const codes = parsePointsList(parsed.data.points);

    const { rows: registrations } = await this.fleetPool.query<{ point_key: string; unit: string | null }>(
      `SELECT point_key, unit FROM bms.asset_points WHERE asset_id = $1 AND active`,
      [id.data],
    );
    const units = new Map(registrations.map((row) => [row.point_key, row.unit]));
    if (codes.some((code) => !units.has(code))) {
      throw new NotFoundException(POINT_NOT_REGISTERED);
    }

    const range = resolveAggregateRange(parsed.data, now);
    const level = levelFor(windowBoundsFor(range, compare), range.windowMinutes, now);
    assertViewExportWithinCap(assetHistoryExportRowCount(codes.length, range.windowMinutes, level, compare), cap);

    const responses = await Promise.all(
      codes.map((pointKey) =>
        this.telemetry.pointAggregate(
          { assetId: id.data, pointKey },
          {
            from: range.from,
            to: range.to,
            windowMinutes: range.windowMinutes,
            compare,
            bucketFunction,
            bucketStats: true,
            now,
          },
        ),
      ),
    );

    const points: HistoryExportPoint[] = responses.map((response, index) => ({
      pointKey: codes[index] as string,
      unit: units.get(codes[index] as string) ?? null,
      current: response.buckets ?? [],
      compare: compare ? (response.compare?.buckets ?? []) : null,
    }));
    return assetHistoryExportRows(
      {
        zone: responses[0]?.timeZone ?? FALLBACK_ZONE,
        level,
        bucket: level,
        from: range.from.toISOString(),
        to: range.to.toISOString(),
      },
      points,
    );
  }

  async exportCsv(jwt: JwtPayload, assetId: string, query: unknown): Promise<string> {
    return viewExportCsv(await this.exportRows(jwt, assetId, query));
  }

  async exportXlsx(jwt: JwtPayload, assetId: string, query: unknown): Promise<Buffer> {
    return viewExportXlsx(await this.exportRows(jwt, assetId, query));
  }
}
