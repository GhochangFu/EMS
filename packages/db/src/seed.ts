import { config as loadEnv } from "dotenv";
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { resolve } from "node:path";
import pg from "pg";

import { mapLocationRowsForInsert } from "./map-locations-seed";
import { createDb } from "./client";
import {
  alarms,
  automationRules,
  assets,
  maintenanceSchedules,
  maintenanceTaskTemplates,
  mapLocations,
  users,
  workOrderTasks,
  workOrders,
} from "./schema/bms-schema";

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

    const existingWorkOrders = await db
      .select({ id: workOrders.id })
      .from(workOrders)
      .limit(1);
    if (existingWorkOrders.length === 0) {
      const seededAlarms = await db
        .select({ id: alarms.id, assetId: alarms.assetId })
        .from(alarms)
        .limit(2);
      const alarmSeed = seededAlarms[0];
      const upsAsset = assetRows.find((row) => row.code === "UPS-A") ?? assetRows[0];
      const cracAsset =
        assetRows.find((row) => row.code === "CH-CRAC-101") ?? assetRows[0];

      const insertedWorkOrders = await db
        .insert(workOrders)
        .values([
          {
            assetId: alarmSeed?.assetId ?? upsAsset.id,
            alarmId: alarmSeed?.id,
            title: "Investigate alarm follow-up",
            description:
              "Demo work order linked to an existing alarm for operator handover.",
            status: "open",
            priority: "high",
            createdBy: adminId,
            dueAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
          },
          {
            assetId: cracAsset.id,
            title: "Inspect CRAC condensate drain",
            description:
              "Demo asset-driven work order for preventive operations follow-up.",
            status: "assigned",
            priority: "medium",
            assignedTo: adminId,
            createdBy: adminId,
            dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        ])
        .returning({ id: workOrders.id, title: workOrders.title });

      const taskRows = insertedWorkOrders.flatMap((workOrder, index) => [
        {
          workOrderId: workOrder.id,
          title: index === 0 ? "Review alarm history" : "Inspect equipment locally",
          sortOrder: 1,
        },
        {
          workOrderId: workOrder.id,
          title: index === 0 ? "Record corrective action" : "Record inspection notes",
          sortOrder: 2,
        },
      ]);
      if (taskRows.length > 0) {
        await db.insert(workOrderTasks).values(taskRows);
      }
    }

    const existingMaintenance = await db
      .select({ id: maintenanceTaskTemplates.id })
      .from(maintenanceTaskTemplates)
      .limit(1);
    if (existingMaintenance.length === 0) {
      const day = 24 * 60 * 60 * 1000;
      const upsAsset = assetRows.find((row) => row.code === "UPS-A") ?? assetRows[0];
      const cracAsset =
        assetRows.find((row) => row.code === "CH-CRAC-101") ?? assetRows[0];
      const pvAsset =
        assetRows.find((row) => row.code === "PV-INV-01") ?? assetRows[0];
      const insertedTemplates = await db
        .insert(maintenanceTaskTemplates)
        .values([
          {
            assetId: upsAsset.id,
            title: "UPS battery string inspection",
            description:
              "Preventive inspection for terminals, impedance trend, and autonomy test readiness.",
            category: "preventive",
            generationMode: "calendar",
            ownerTeam: "Electrical maintenance",
            priority: "high",
            estimatedMinutes: 90,
          },
          {
            assetId: cracAsset.id,
            title: "CRAC filter and condensate check",
            description:
              "Clean intake filter, inspect condensate drain, and confirm supply-air temperature stability.",
            category: "condition_based",
            generationMode: "condition",
            ownerTeam: "Cooling operations",
            triggerSummary: "Filter pressure and condensate condition review",
            priority: "medium",
            estimatedMinutes: 60,
          },
          {
            assetId: pvAsset.id,
            title: "PV inverter thermal inspection",
            description:
              "Inspect fans, heatsink temperature, DC isolator condition, and event log.",
            category: "energy_optimization",
            generationMode: "predictive",
            ownerTeam: "Energy operations",
            triggerSummary: "Thermal trend and inverter derating review",
            priority: "medium",
            estimatedMinutes: 45,
          },
        ])
        .returning({
          id: maintenanceTaskTemplates.id,
          title: maintenanceTaskTemplates.title,
        });

      const scheduleRows = insertedTemplates.map((template, index) => ({
        templateId: template.id,
        intervalDays: index === 0 ? 30 : index === 1 ? 14 : 60,
        nextDueAt:
          index === 0
            ? new Date(Date.now() - 2 * day)
            : new Date(Date.now() + (index + 2) * day),
        lastCompletedAt:
          index === 0 ? new Date(Date.now() - 32 * day) : undefined,
      }));
      if (scheduleRows.length > 0) {
        await db.insert(maintenanceSchedules).values(scheduleRows);
      }
    }
    await db
      .update(maintenanceTaskTemplates)
      .set({
        ownerTeam: "Electrical maintenance",
      })
      .where(eq(maintenanceTaskTemplates.title, "UPS battery string inspection"));
    await db
      .update(maintenanceTaskTemplates)
      .set({
        category: "condition_based",
        generationMode: "condition",
        ownerTeam: "Cooling operations",
        triggerSummary: "Filter pressure and condensate condition review",
      })
      .where(
        eq(maintenanceTaskTemplates.title, "CRAC filter and condensate check"),
      );
    await db
      .update(maintenanceTaskTemplates)
      .set({
        category: "energy_optimization",
        generationMode: "predictive",
        ownerTeam: "Energy operations",
        triggerSummary: "Thermal trend and inverter derating review",
      })
      .where(eq(maintenanceTaskTemplates.title, "PV inverter thermal inspection"));

    const existingRules = await db
      .select({ id: automationRules.id })
      .from(automationRules)
      .limit(1);
    if (existingRules.length === 0) {
      const upsAsset = assetRows.find((row) => row.code === "UPS-A") ?? assetRows[0];
      const cracAsset =
        assetRows.find((row) => row.code === "CH-CRAC-101") ?? assetRows[0];
      const pvAsset =
        assetRows.find((row) => row.code === "PV-INV-01") ?? assetRows[0];
      await db.insert(automationRules).values([
        {
          code: "demand_ceiling_notify",
          name: "Energy demand ceiling notification",
          description:
            "IF current demand is above 115 kW THEN notify Energy Manager.",
          category: "energy",
          ruleType: "threshold",
          assetId: upsAsset.id,
          pointKey: "kw",
          operator: "gte",
          thresholdValue: 115,
          severity: "warning",
          condition: { window: "latest", unit: "kW" },
          action: { type: "notify", target: "Energy Manager" },
        },
        {
          code: "crac_supply_temp_high",
          name: "CRAC supply temperature watch",
          description:
            "IF supply air temperature is above 24 C THEN flag cooling operations.",
          category: "comfort",
          ruleType: "threshold",
          assetId: cracAsset.id,
          pointKey: "supply_air_temp_c",
          operator: "gte",
          thresholdValue: 24,
          severity: "warning",
          condition: { window: "latest", unit: "C" },
          action: { type: "notify", target: "Cooling operations" },
        },
        {
          code: "weekday_energy_review",
          name: "Weekday energy review window",
          description:
            "IF it is a weekday between 06:00 and 08:00 THEN prompt energy review.",
          category: "energy",
          ruleType: "time_window",
          assetId: pvAsset.id,
          enabled: false,
          condition: {
            days: ["mon", "tue", "wed", "thu", "fri"],
            startTime: "06:00",
            endTime: "08:00",
          },
          action: { type: "review", target: "Energy operations" },
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
