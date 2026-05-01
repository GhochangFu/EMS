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
  const controlRoomSiteName = "SMOC Cape Town";

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
    ] as const;

    const assetRows: { id: string; code: string }[] = [];
    for (const a of sampleAssets) {
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

    const crBreakerRules = [
      ["CR-Q1", "Main MCCB"],
      ["CR-Q2", "UPS-1 input feeder"],
      ["CR-Q3", "UPS-2 input feeder"],
      ["CR-Q4", "UPS-1 output feeder"],
      ["CR-Q5", "UPS-2 output feeder"],
      ["CR-Q6", "Network Rack PDU-A feeder"],
      ["CR-Q7", "Network Rack PDU-B feeder"],
      ["CR-Q8", "Videowall PDU-A feeder"],
      ["CR-Q9", "Videowall PDU-B feeder"],
      ["CR-Q10", "HVAC-1 feeder"],
      ["CR-Q11", "HVAC-2 feeder"],
      ["CR-Q12", "Control Room lighting feeder"],
    ] as const;

    for (const [assetCode, feederName] of crBreakerRules) {
      const breakerAsset = assetRows.find((row) => row.code === assetCode);
      if (!breakerAsset) {
        continue;
      }
      const breakerNumber = assetCode.replace("CR-Q", "Q");
      const ruleCode =
        assetCode === "CR-Q9"
          ? "CR_Q9_VW_PDU_B_CURRENT_WARNING"
          : `${assetCode.replace("-", "_")}_CURRENT_WARNING`;
      const ruleValues = {
        name: `CR ${breakerNumber} current warning`,
        description: `IF ${breakerNumber} current is above 3 A THEN flag the ${feederName}.`,
        category: "operations",
        ruleType: "threshold",
        assetId: breakerAsset.id,
        pointKey: "current_a",
        operator: "gt",
        thresholdValue: 3,
        severity: "warning",
        condition: { window: "latest", unit: "A" },
        action: { type: "notify", target: "Control room operations" },
      } as const;
      const existingCrRules = await db
        .select({ id: automationRules.id, code: automationRules.code })
        .from(automationRules)
        .orderBy(automationRules.createdAt);
      const existingCrRule = existingCrRules.find(
        (rule) => rule.code.trim().toUpperCase() === ruleCode,
      );
      if (existingCrRule) {
        await db
          .update(automationRules)
          .set({ code: ruleCode })
          .where(eq(automationRules.id, existingCrRule.id));
        continue;
      }
      await db.insert(automationRules).values({
        code: ruleCode,
        ...ruleValues,
      });
    }

    const crPduRules = [
      ["CR-NET-RACK-PDU-A", "Network Rack PDU-A"],
      ["CR-NET-RACK-PDU-B", "Network Rack PDU-B"],
      ["CR-VW-RACK-PDU-A", "Videowall Rack PDU-A"],
      ["CR-VW-RACK-PDU-B", "Videowall Rack PDU-B"],
    ] as const;

    for (const [assetCode, pduName] of crPduRules) {
      const pduAsset = assetRows.find((row) => row.code === assetCode);
      if (!pduAsset) {
        continue;
      }
      const ruleCode = `${assetCode.replaceAll("-", "_")}_UTIL_WARNING`;
      const ruleValues = {
        name: `${pduName} utilisation warning`,
        description: `IF ${pduName} utilisation is above 85% THEN flag rack power capacity.`,
        category: "operations",
        ruleType: "threshold",
        assetId: pduAsset.id,
        pointKey: "pdu_util_pct",
        operator: "gt",
        thresholdValue: 85,
        severity: "warning",
        condition: { window: "latest", unit: "%" },
        action: { type: "notify", target: "Control room operations" },
      } as const;
      const existingPduRules = await db
        .select({ id: automationRules.id, code: automationRules.code })
        .from(automationRules)
        .orderBy(automationRules.createdAt);
      const existingPduRule = existingPduRules.find(
        (rule) => rule.code.trim().toUpperCase() === ruleCode,
      );
      if (existingPduRule) {
        await db
          .update(automationRules)
          .set({ code: ruleCode })
          .where(eq(automationRules.id, existingPduRule.id));
        continue;
      }
      await db.insert(automationRules).values({
        code: ruleCode,
        ...ruleValues,
      });
    }

    const crBatteryRules = [
      {
        assetCode: "CR-BATT-1",
        code: "CR_BATT_1_TEMP_WARNING",
        name: "CR Battery String 1 temperature warning",
        description:
          "IF CR Battery String 1 temperature is at or above 30 C THEN notify control room operations.",
        pointKey: "battery_temp_c",
        operator: "gte",
        thresholdValue: 30,
        unit: "C",
      },
      {
        assetCode: "CR-BATT-2",
        code: "CR_BATT_2_TEMP_WARNING",
        name: "CR Battery String 2 temperature warning",
        description:
          "IF CR Battery String 2 temperature is at or above 30 C THEN notify control room operations.",
        pointKey: "battery_temp_c",
        operator: "gte",
        thresholdValue: 30,
        unit: "C",
      },
      {
        assetCode: "CR-BATT-1",
        code: "CR_BATT_1_BACKUP_LOW",
        name: "CR Battery String 1 backup low",
        description:
          "IF CR Battery String 1 backup runtime is below 20 minutes THEN notify control room operations.",
        pointKey: "backup_min",
        operator: "lt",
        thresholdValue: 20,
        unit: "min",
      },
      {
        assetCode: "CR-BATT-2",
        code: "CR_BATT_2_BACKUP_LOW",
        name: "CR Battery String 2 backup low",
        description:
          "IF CR Battery String 2 backup runtime is below 20 minutes THEN notify control room operations.",
        pointKey: "backup_min",
        operator: "lt",
        thresholdValue: 20,
        unit: "min",
      },
    ] as const;

    for (const batteryRule of crBatteryRules) {
      const batteryAsset = assetRows.find((row) => row.code === batteryRule.assetCode);
      if (!batteryAsset) {
        continue;
      }
      const existingBatteryRules = await db
        .select({ id: automationRules.id, code: automationRules.code })
        .from(automationRules)
        .orderBy(automationRules.createdAt);
      const existingBatteryRule = existingBatteryRules.find(
        (rule) => rule.code.trim().toUpperCase() === batteryRule.code,
      );
      if (existingBatteryRule) {
        await db
          .update(automationRules)
          .set({ code: batteryRule.code })
          .where(eq(automationRules.id, existingBatteryRule.id));
        continue;
      }
      await db.insert(automationRules).values({
        code: batteryRule.code,
        name: batteryRule.name,
        description: batteryRule.description,
        category: "operations",
        ruleType: "threshold",
        assetId: batteryAsset.id,
        pointKey: batteryRule.pointKey,
        operator: batteryRule.operator,
        thresholdValue: batteryRule.thresholdValue,
        severity: "warning",
        condition: { window: "latest", unit: batteryRule.unit },
        action: { type: "notify", target: "Control room operations" },
      });
    }

    const crHvacRules = [
      {
        assetCode: "CR-HVAC-1",
        code: "CR_HVAC_1_RETURN_TEMP_WARNING",
        name: "CR HVAC 1 return air warning",
        description:
          "IF CR HVAC 1 return air temperature is at or above 26 C THEN notify control room operations.",
        pointKey: "return_air_temp_c",
        operator: "gte",
        thresholdValue: 26,
        severity: "warning",
        unit: "C",
      },
      {
        assetCode: "CR-HVAC-2",
        code: "CR_HVAC_2_RETURN_TEMP_WARNING",
        name: "CR HVAC 2 return air warning",
        description:
          "IF CR HVAC 2 return air temperature is at or above 26 C THEN notify control room operations.",
        pointKey: "return_air_temp_c",
        operator: "gte",
        thresholdValue: 26,
        severity: "warning",
        unit: "C",
      },
      {
        assetCode: "CR-HVAC-1",
        code: "CR_HVAC_1_COMPRESSOR_FAULT",
        name: "CR HVAC 1 compressor fault",
        description:
          "IF CR HVAC 1 compressor health is faulted THEN raise a critical control room HVAC alarm.",
        pointKey: "compressor_ok",
        operator: "eq",
        thresholdValue: 0,
        severity: "critical",
        unit: "state",
      },
      {
        assetCode: "CR-HVAC-2",
        code: "CR_HVAC_2_COMPRESSOR_FAULT",
        name: "CR HVAC 2 compressor fault",
        description:
          "IF CR HVAC 2 compressor health is faulted THEN raise a critical control room HVAC alarm.",
        pointKey: "compressor_ok",
        operator: "eq",
        thresholdValue: 0,
        severity: "critical",
        unit: "state",
      },
    ] as const;

    for (const hvacRule of crHvacRules) {
      const hvacAsset = assetRows.find((row) => row.code === hvacRule.assetCode);
      if (!hvacAsset) {
        continue;
      }
      const existingHvacRules = await db
        .select({ id: automationRules.id, code: automationRules.code })
        .from(automationRules)
        .orderBy(automationRules.createdAt);
      const existingHvacRule = existingHvacRules.find(
        (rule) => rule.code.trim().toUpperCase() === hvacRule.code,
      );
      if (existingHvacRule) {
        await db
          .update(automationRules)
          .set({ code: hvacRule.code })
          .where(eq(automationRules.id, existingHvacRule.id));
        continue;
      }
      await db.insert(automationRules).values({
        code: hvacRule.code,
        name: hvacRule.name,
        description: hvacRule.description,
        category: "operations",
        ruleType: "threshold",
        assetId: hvacAsset.id,
        pointKey: hvacRule.pointKey,
        operator: hvacRule.operator,
        thresholdValue: hvacRule.thresholdValue,
        severity: hvacRule.severity,
        condition: { window: "latest", unit: hvacRule.unit },
        action: { type: "notify", target: "Control room operations" },
      });
    }

    const crEnvironmentRules = [
      ...[
        ["CR-ENV-OP-CONSOLE", "Operator Console", 27],
        ["CR-ENV-VIDEOWALL", "Videowall Bay", 27],
        ["CR-ENV-RACK-A", "Rack Bay A", 28],
        ["CR-ENV-RACK-B", "Rack Bay B", 28],
        ["CR-ENV-BATTERY-ROOM", "Battery Room", 30],
        ["CR-ENV-UPS-ROOM", "UPS Room", 30],
      ].map(([assetCode, zoneName, threshold]) => ({
        assetCode: String(assetCode),
        code: `${String(assetCode).replaceAll("-", "_")}_TEMP_WARNING`,
        name: `${zoneName} temperature warning`,
        description: `IF ${zoneName} temperature is at or above ${threshold} C THEN notify control room operations.`,
        pointKey: "temperature_c",
        operator: "gte",
        thresholdValue: Number(threshold),
        severity: "warning",
        unit: "C",
      })),
      ...[
        ["CR-LEAK-01", "AHU-1 drain pan"],
        ["CR-LEAK-02", "AHU-2 drain pan"],
        ["CR-LEAK-03", "Raised floor NW"],
        ["CR-LEAK-04", "Battery room floor"],
      ].map(([assetCode, location]) => ({
        assetCode: String(assetCode),
        code: `${String(assetCode).replaceAll("-", "_")}_WET_ALARM`,
        name: `${location} leak alarm`,
        description: `IF ${location} leak sensor is wet THEN raise a critical environment alarm.`,
        pointKey: "leak_state",
        operator: "eq",
        thresholdValue: 1,
        severity: "critical",
        unit: "state",
      })),
      ...[
        ["CR-SMOKE-01", "Operator zone"],
        ["CR-SMOKE-02", "Videowall bay"],
        ["CR-SMOKE-03", "Rack bay"],
        ["CR-SMOKE-04", "Battery room"],
      ].map(([assetCode, location]) => ({
        assetCode: String(assetCode),
        code: `${String(assetCode).replaceAll("-", "_")}_SMOKE_ALARM`,
        name: `${location} smoke alarm`,
        description: `IF ${location} smoke detector is in alarm THEN raise a critical environment alarm.`,
        pointKey: "smoke_state",
        operator: "eq",
        thresholdValue: 1,
        severity: "critical",
        unit: "state",
      })),
    ] as const;

    for (const environmentRule of crEnvironmentRules) {
      const environmentAsset = assetRows.find(
        (row) => row.code === environmentRule.assetCode,
      );
      if (!environmentAsset) {
        continue;
      }
      const existingEnvironmentRules = await db
        .select({ id: automationRules.id, code: automationRules.code })
        .from(automationRules)
        .orderBy(automationRules.createdAt);
      const existingEnvironmentRule = existingEnvironmentRules.find(
        (rule) => rule.code.trim().toUpperCase() === environmentRule.code,
      );
      if (existingEnvironmentRule) {
        await db
          .update(automationRules)
          .set({ code: environmentRule.code })
          .where(eq(automationRules.id, existingEnvironmentRule.id));
        continue;
      }
      await db.insert(automationRules).values({
        code: environmentRule.code,
        name: environmentRule.name,
        description: environmentRule.description,
        category: "operations",
        ruleType: "threshold",
        assetId: environmentAsset.id,
        pointKey: environmentRule.pointKey,
        operator: environmentRule.operator,
        thresholdValue: environmentRule.thresholdValue,
        severity: environmentRule.severity,
        condition: { window: "latest", unit: environmentRule.unit },
        action: { type: "notify", target: "Control room operations" },
      });
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
