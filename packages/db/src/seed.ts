import { config as loadEnv } from "dotenv";
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { resolve } from "node:path";
import pg from "pg";

import { mapLocationRowsForInsert } from "./map-locations-seed";
import { createDb } from "./client";
import { alarms, assets, mapLocations, users } from "./schema/bms-schema";

const pkgRoot = process.cwd();

loadEnv({ path: resolve(pkgRoot, "../../apps/api/.env") });
loadEnv({ path: resolve(pkgRoot, ".env") });

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for seed");
  }

  const pool = new pg.Pool({ connectionString: databaseUrl });
  const db = createDb(pool);

  try {
    const adminEmail = "admin@bms.local";
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, adminEmail))
      .limit(1);

    let adminId = existing[0]?.id;
    if (!adminId) {
      const passwordHash = await bcrypt.hash("admin123", 10);
      const inserted = await db
        .insert(users)
        .values({
          email: adminEmail,
          passwordHash,
          displayName: "System Administrator",
          role: "admin",
        })
        .returning({ id: users.id });
      adminId = inserted[0]?.id;
      if (!adminId) {
        throw new Error("Failed to insert admin user");
      }
    }

    const sampleAssets = [
      {
        code: "TX-L1-MV",
        name: "Main TX L1",
        siteName: "SMOC Pretoria North",
        domain: "electrical",
      },
      {
        code: "SWG-MDB1",
        name: "Main Distribution Board 1",
        siteName: "SMOC Pretoria North",
        domain: "electrical",
      },
      {
        code: "UPS-A",
        name: "UPS String A",
        siteName: "SMOC Pretoria North",
        domain: "electrical",
      },
      {
        code: "CH-CRAC-101",
        name: "CRAC 101",
        siteName: "SMOC Pretoria North",
        domain: "hvac",
      },
      {
        code: "CH-CRAC-102",
        name: "CRAC 102",
        siteName: "SMOC Pretoria North",
        domain: "hvac",
      },
      {
        code: "CH-CRAC-103",
        name: "CRAC 103",
        siteName: "SMOC Pretoria North",
        domain: "hvac",
      },
      {
        code: "CH-CRAC-104",
        name: "CRAC 104",
        siteName: "SMOC Pretoria North",
        domain: "hvac",
      },
      {
        code: "PV-INV-01",
        name: "PV Inverter 01",
        siteName: "SMOC Cape Town",
        domain: "electrical",
      },
    ] as const;

    const assetRows: { id: string; code: string }[] = [];
    for (const a of sampleAssets) {
      const row = await db
        .select({ id: assets.id })
        .from(assets)
        .where(eq(assets.code, a.code))
        .limit(1);
      if (row[0]) {
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
        })
        .returning({ id: assets.id, code: assets.code });
      if (ins[0]) {
        assetRows.push(ins[0]);
      }
    }

    const firstAssetId = assetRows[0]?.id;
    if (!firstAssetId) {
      throw new Error("No assets available for alarm seed");
    }

    const existingAlarms = await db.select({ id: alarms.id }).from(alarms).limit(1);
    if (existingAlarms.length === 0) {
      const day = 24 * 60 * 60 * 1000;
      await db.insert(alarms).values([
        {
          assetId: firstAssetId,
          severity: "warning",
          message: "Voltage imbalance >2% sustained 5 min (historical seed)",
          raisedAt: new Date(Date.now() - 3 * day),
          acknowledgedAt: new Date(Date.now() - 2 * day),
          acknowledgedBy: adminId,
        },
        {
          assetId: firstAssetId,
          severity: "info",
          message: "Maintenance window scheduled — breaker inspection",
          raisedAt: new Date(Date.now() - 1 * day),
        },
        {
          assetId: assetRows[1]?.id ?? firstAssetId,
          severity: "critical",
          message: "UPS battery test failed — replace string B (historical seed)",
          raisedAt: new Date(Date.now() - 5 * day),
          acknowledgedAt: new Date(Date.now() - 4 * day),
          acknowledgedBy: adminId,
        },
      ]);
    }

    for (const row of mapLocationRowsForInsert()) {
      const exists = await db
        .select({ id: mapLocations.id })
        .from(mapLocations)
        .where(eq(mapLocations.slug, row.slug))
        .limit(1);
      if (exists[0]) {
        continue;
      }
      await db.insert(mapLocations).values({
        slug: row.slug,
        name: row.name,
        kind: row.kind,
        siteName: row.siteName,
        latitude: row.latitude,
        longitude: row.longitude,
        capacityMw: row.capacityMw,
        stationType: row.stationType,
        stationCategory: row.stationCategory,
        province: row.province,
        stationOperatingStatus: row.stationOperatingStatus,
        meta: row.meta,
      });
    }
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
