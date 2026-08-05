import { eq } from "drizzle-orm";

import type { BmsDb } from "./client";
import type { SeededAsset } from "./eskom-assets-seed";
import {
  alarms,
  maintenanceSchedules,
  maintenanceTaskTemplates,
  workOrderTasks,
  workOrders,
} from "./schema/bms-schema";

/**
 * Demo alarm, work-order and maintenance rows, split out of `seed.ts` to keep
 * it under the AGENTS.md §4.5 1000-line cap. Pure move: each function guards on
 * its own table being empty, which is what keeps `pnpm db:seed` idempotent.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Seeds three historical demo alarms against the first two seeded assets. */
export async function seedDemoAlarms(
  db: BmsDb,
  assetRows: readonly SeededAsset[],
  adminId: string,
): Promise<void> {
  const firstAssetId = assetRows[0]?.id;
  if (!firstAssetId) {
    throw new Error("No assets available for alarm seed");
  }

  const existingAlarms = await db.select({ id: alarms.id }).from(alarms).limit(1);
  if (existingAlarms.length === 0) {
    const day = DAY_MS;
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
}

/** Seeds two demo work orders with their checklist tasks. */
export async function seedDemoWorkOrders(
  db: BmsDb,
  assetRows: readonly SeededAsset[],
  adminId: string,
): Promise<void> {
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
          dueAt: new Date(Date.now() + 2 * DAY_MS),
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
          dueAt: new Date(Date.now() + 7 * DAY_MS),
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
}

/**
 * Seeds the three maintenance task templates and their schedules, then
 * re-applies the classification fields on every run so an older seeded row
 * picks up the current category / generation mode / owner team.
 */
export async function seedMaintenancePlans(
  db: BmsDb,
  assetRows: readonly SeededAsset[],
): Promise<void> {
  const existingMaintenance = await db
    .select({ id: maintenanceTaskTemplates.id })
    .from(maintenanceTaskTemplates)
    .limit(1);
  if (existingMaintenance.length === 0) {
    const day = DAY_MS;
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
}
