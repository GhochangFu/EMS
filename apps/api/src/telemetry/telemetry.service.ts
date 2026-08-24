import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, gte, sql } from "drizzle-orm";

import { pointValues } from "@bms/db";
import type { BmsDb } from "@bms/db";
import { decodePointRefParam, type TelemetryReading } from "@bms/shared";

import { TENANT_DRIZZLE } from "../database/database.tokens";

@Injectable()
export class TelemetryService {
  constructor(@Inject(TENANT_DRIZZLE) private readonly db: BmsDb) {}

  /**
   * Returns recent samples for one logical point (`assetId::pointKey`).
   * @param window e.g. `15m`, `1h`
   */
  async recentForPoint(pointRef: string, window?: string): Promise<TelemetryReading[]> {
    let assetId: string;
    let pointKey: string;
    try {
      ({ assetId, pointKey } = decodePointRefParam(pointRef));
    } catch {
      throw new BadRequestException("Invalid point reference");
    }

    const { n, unit } = this.parseWindow(window);

    const intervalExpr =
      unit === "m"
        ? sql.raw(`${n} * interval '1 minute'`)
        : sql.raw(`${n} * interval '1 hour'`);

    const rows = await this.db
      .select({
        time: pointValues.time,
        assetId: pointValues.assetId,
        pointKey: pointValues.pointKey,
        value: pointValues.value,
        unit: pointValues.unit,
      })
      .from(pointValues)
      .where(
        and(
          eq(pointValues.assetId, assetId),
          eq(pointValues.pointKey, pointKey),
          gte(pointValues.time, sql`now() - ${intervalExpr}`),
        ),
      )
      .orderBy(desc(pointValues.time))
      .limit(5000);

    return rows.map((r) => ({
      time: r.time.toISOString(),
      assetId: r.assetId,
      pointKey: r.pointKey,
      value: r.value,
      unit: r.unit,
    }));
  }

  private parseWindow(raw?: string): { n: number; unit: "m" | "h" } {
    const w = (raw ?? "15m").trim();
    const m = /^(\d+)(m|h)$/.exec(w);
    if (!m) {
      throw new BadRequestException(
        'Invalid window; use suffix m or h (e.g. "15m", "1h")',
      );
    }
    const n = Number(m[1]);
    const unit = m[2] as "m" | "h";
    if (n < 1 || n > 168) {
      throw new BadRequestException("Window out of range (1–168 m or h)");
    }
    return { n, unit };
  }
}
