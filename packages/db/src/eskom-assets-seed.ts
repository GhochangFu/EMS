import { eq } from "drizzle-orm";
import type pg from "pg";

import type { BmsDb } from "./client";
import { provinceCode } from "./eskom-locations-seed";
import { resolveEskomSimRtuId } from "./hierarchy-seed";
import { assets } from "./schema/bms-schema";

/**
 * The Eskom demo asset catalog and its upsert, split out of `seed.ts` to keep
 * it under the AGENTS.md §4.5 1000-line cap. Pure move — the catalog order is
 * load-bearing (the alarm seed keys off the first two inserted assets), so the
 * entries stay in their original sequence with the RSMOC block last.
 */

/** One catalog entry; `meta` defaults to the simulator marker when absent. */
export type EskomAssetSpec = {
  readonly code: string;
  readonly name: string;
  readonly siteName: string;
  readonly domain: string;
  readonly meta?: unknown;
};

/** An asset row as the downstream demo seeds need to reference it. */
export type SeededAsset = { id: string; code: string };

/** Control-room demo assets for a regional centre, empty for Western Cape. */
export function demoAssetsForRsmoc(
  siteName: string,
  province: string,
): readonly EskomAssetSpec[] {
  const prefix = provinceCode(province);
  if (!prefix || province === "Western Cape") {
    return [];
  }
  const readableName = province;
  return [
    {
      code: `${prefix}-CR-UTILITY`,
      name: `${readableName} Control Room Utility Incomer`,
      siteName,
      domain: "electrical",
    },
    {
      code: `${prefix}-CR-UPS-1`,
      name: `${readableName} Control Room UPS 1`,
      siteName,
      domain: "electrical",
    },
    {
      code: `${prefix}-CR-BATT-1`,
      name: `${readableName} Control Room Battery String 1`,
      siteName,
      domain: "electrical",
    },
    {
      code: `${prefix}-CR-HVAC-1`,
      name: `${readableName} Control Room HVAC 1`,
      siteName,
      domain: "hvac",
    },
    {
      code: `${prefix}-CR-NET-RACK`,
      name: `${readableName} Control Room Network Rack`,
      siteName,
      domain: "it",
    },
    {
      code: `${prefix}-CR-ENV-ROOM`,
      name: `${readableName} Control Room Environment`,
      siteName,
      domain: "environment",
    },
  ];
}

/** The full seeded asset list; order is significant, RSMOC assets stay last. */
export function buildEskomAssetCatalog(
  controlRoomSiteName: string,
  rsmocDemoAssets: readonly EskomAssetSpec[],
): readonly EskomAssetSpec[] {
  return [
    {
      code: "TX-L1-MV",
      name: "Main TX L1",
      siteName: "CSMOC Gauteng",
      domain: "electrical",
    },
    {
      code: "SWG-MDB1",
      name: "Main Distribution Board 1",
      siteName: "CSMOC Gauteng",
      domain: "electrical",
    },
    {
      code: "UPS-A",
      name: "UPS String A",
      siteName: "CSMOC Gauteng",
      domain: "electrical",
    },
    {
      code: "CH-CRAC-101",
      name: "CRAC 101",
      siteName: "CSMOC Gauteng",
      domain: "hvac",
    },
    {
      code: "CH-CRAC-102",
      name: "CRAC 102",
      siteName: "CSMOC Gauteng",
      domain: "hvac",
    },
    {
      code: "CH-CRAC-103",
      name: "CRAC 103",
      siteName: "CSMOC Gauteng",
      domain: "hvac",
    },
    {
      code: "CH-CRAC-104",
      name: "CRAC 104",
      siteName: "CSMOC Gauteng",
      domain: "hvac",
    },
    {
      code: "PV-INV-01",
      name: "PV Inverter 01",
      siteName: "CSMOC Gauteng",
      domain: "electrical",
    },
    {
      code: "CR-UTILITY-11KV",
      name: "Control Room Utility 11 kV Incomer",
      siteName: controlRoomSiteName,
      domain: "electrical",
    },
    {
      code: "CR-XFMR-100KVA",
      name: "Control Room Transformer 100 kVA",
      siteName: controlRoomSiteName,
      domain: "electrical",
    },
    {
      code: "CR-MAIN-BUS",
      name: "Control Room Main Bus 415 V",
      siteName: controlRoomSiteName,
      domain: "electrical",
    },
    {
      code: "CR-UPS-OUT-BUS",
      name: "Control Room UPS Output Bus",
      siteName: controlRoomSiteName,
      domain: "electrical",
    },
    ...Array.from({ length: 12 }, (_, i) => ({
      code: `CR-Q${i + 1}`,
      name: `Control Room Breaker Q${i + 1}`,
      siteName: controlRoomSiteName,
      domain: "electrical",
    })),
    {
      code: "CR-UPS-1",
      name: "Control Room UPS 1",
      siteName: controlRoomSiteName,
      domain: "electrical",
    },
    {
      code: "CR-UPS-2",
      name: "Control Room UPS 2",
      siteName: controlRoomSiteName,
      domain: "electrical",
    },
    {
      code: "CR-BATT-1",
      name: "Control Room Battery String 1",
      siteName: controlRoomSiteName,
      domain: "electrical",
    },
    {
      code: "CR-BATT-2",
      name: "Control Room Battery String 2",
      siteName: controlRoomSiteName,
      domain: "electrical",
    },
    {
      code: "CR-HVAC-1",
      name: "Control Room HVAC 1",
      siteName: controlRoomSiteName,
      domain: "hvac",
    },
    {
      code: "CR-HVAC-2",
      name: "Control Room HVAC 2",
      siteName: controlRoomSiteName,
      domain: "hvac",
    },
    {
      code: "CR-LIGHT-AUX",
      name: "Control Room Lighting and Auxiliary Loads",
      siteName: controlRoomSiteName,
      domain: "electrical",
    },
    {
      code: "CR-NET-RACK",
      name: "Control Room Network Rack",
      siteName: controlRoomSiteName,
      domain: "it",
    },
    {
      code: "CR-VW-SRV-RACK",
      name: "Control Room Videowall Server Rack",
      siteName: controlRoomSiteName,
      domain: "it",
    },
    {
      code: "CR-NET-RACK-PDU-A",
      name: "Network Rack PDU A",
      siteName: controlRoomSiteName,
      domain: "it",
    },
    {
      code: "CR-NET-RACK-PDU-B",
      name: "Network Rack PDU B",
      siteName: controlRoomSiteName,
      domain: "it",
    },
    {
      code: "CR-VW-RACK-PDU-A",
      name: "Videowall Server Rack PDU A",
      siteName: controlRoomSiteName,
      domain: "it",
    },
    {
      code: "CR-VW-RACK-PDU-B",
      name: "Videowall Server Rack PDU B",
      siteName: controlRoomSiteName,
      domain: "it",
    },
    {
      code: "CR-ENV-OP-CONSOLE",
      name: "Control Room Operator Console Environment",
      siteName: controlRoomSiteName,
      domain: "environment",
    },
    {
      code: "CR-ENV-VIDEOWALL",
      name: "Control Room Videowall Environment",
      siteName: controlRoomSiteName,
      domain: "environment",
    },
    {
      code: "CR-ENV-RACK-A",
      name: "Control Room Rack Bay A Environment",
      siteName: controlRoomSiteName,
      domain: "environment",
    },
    {
      code: "CR-ENV-RACK-B",
      name: "Control Room Rack Bay B Environment",
      siteName: controlRoomSiteName,
      domain: "environment",
    },
    {
      code: "CR-ENV-BATTERY-ROOM",
      name: "Control Room Battery Room Environment",
      siteName: controlRoomSiteName,
      domain: "environment",
    },
    {
      code: "CR-ENV-UPS-ROOM",
      name: "Control Room UPS Room Environment",
      siteName: controlRoomSiteName,
      domain: "environment",
    },
    {
      code: "CR-LEAK-01",
      name: "AHU-1 Drain Pan Leak Sensor",
      siteName: controlRoomSiteName,
      domain: "environment",
    },
    {
      code: "CR-LEAK-02",
      name: "AHU-2 Drain Pan Leak Sensor",
      siteName: controlRoomSiteName,
      domain: "environment",
    },
    {
      code: "CR-LEAK-03",
      name: "Raised Floor NW Leak Sensor",
      siteName: controlRoomSiteName,
      domain: "environment",
    },
    {
      code: "CR-LEAK-04",
      name: "Battery Room Floor Leak Sensor",
      siteName: controlRoomSiteName,
      domain: "environment",
    },
    {
      code: "CR-SMOKE-01",
      name: "Operator Zone Smoke Detector",
      siteName: controlRoomSiteName,
      domain: "environment",
    },
    {
      code: "CR-SMOKE-02",
      name: "Videowall Bay Smoke Detector",
      siteName: controlRoomSiteName,
      domain: "environment",
    },
    {
      code: "CR-SMOKE-03",
      name: "Rack Bay Smoke Detector",
      siteName: controlRoomSiteName,
      domain: "environment",
    },
    {
      code: "CR-SMOKE-04",
      name: "Battery Room Smoke Detector",
      siteName: controlRoomSiteName,
      domain: "environment",
    },
    ...rsmocDemoAssets,
  ];
}

/** Upserts every catalog asset, returning the rows in insertion order. */
export async function seedEskomAssets(
  db: BmsDb,
  pool: pg.Pool,
  catalog: readonly EskomAssetSpec[],
): Promise<SeededAsset[]> {
  const assetRows: SeededAsset[] = [];
  for (const a of catalog) {
    const rtuId = await resolveEskomSimRtuId(pool, a.siteName, a.domain);
    // ADR 0018: assets.location_id is NOT NULL from migration 0023 onward, so
    // it must be supplied at insert time. This seed used to leave it null and
    // rely on hierarchy-seed backfilling it before the constraint was applied
    // at the very end — an ordering that only worked because the constraint
    // did not exist yet. On a fresh database it now fails on the first row.
    const rtuLoc = await pool.query<{ location_id: string }>(
      `SELECT location_id FROM bms.rtus WHERE id = $1`,
      [rtuId],
    );
    const locationId = rtuLoc.rows[0]?.location_id;
    if (!locationId) {
      throw new Error(`RTU ${rtuId} has no location; cannot seed asset ${a.code}`);
    }
    const row = await db
      .select({ id: assets.id })
      .from(assets)
      .where(eq(assets.code, a.code))
      .limit(1);
    if (row[0]) {
      await db
        .update(assets)
        .set({
          name: a.name,
          siteName: a.siteName,
          domain: a.domain,
          locationId,
          rtuId,
          meta: "meta" in a ? a.meta : { telemetrySource: "simulator" },
        })
        .where(eq(assets.id, row[0].id));
      assetRows.push({ id: row[0].id, code: a.code });
      continue;
    }
    const ins = await db
      .insert(assets)
      .values({
        code: a.code,
        name: a.name,
        siteName: a.siteName,
        domain: a.domain,
        locationId,
        rtuId,
        meta: "meta" in a ? a.meta : { telemetrySource: "simulator" },
      })
      .returning({ id: assets.id, code: assets.code });
    if (ins[0]) {
      assetRows.push(ins[0]);
    }
  }
  return assetRows;
}
