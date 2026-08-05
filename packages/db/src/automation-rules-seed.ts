import { eq } from "drizzle-orm";

import type { BmsDb } from "./client";
import type { SeededAsset } from "./eskom-assets-seed";
import { automationRules } from "./schema/bms-schema";

/**
 * Rule Engine seed rows, split out of `seed.ts` to keep it under the
 * AGENTS.md §4.5 1000-line cap. Pure move: the control-room blocks all ran the
 * same select/update/insert sequence inline, which is now `upsertRuleByCode`.
 */

/** Everything an automation rule row carries except its code. */
type AutomationRuleValues = Omit<typeof automationRules.$inferInsert, "code">;

/**
 * Upserts one rule by code. The lookup reads the whole table on every call
 * rather than filtering in SQL because seeded codes were historically stored
 * with stray whitespace and mixed case; the comparison normalises both, and the
 * update rewrites the code to its canonical form.
 */
async function upsertRuleByCode(
  db: BmsDb,
  code: string,
  values: AutomationRuleValues,
): Promise<void> {
  const existingRules = await db
    .select({ id: automationRules.id, code: automationRules.code })
    .from(automationRules)
    .orderBy(automationRules.createdAt);
  const existingRule = existingRules.find(
    (rule) => rule.code.trim().toUpperCase() === code,
  );
  if (existingRule) {
    await db
      .update(automationRules)
      .set({ code })
      .where(eq(automationRules.id, existingRule.id));
    return;
  }
  await db.insert(automationRules).values({ code, ...values });
}

const CR_BREAKER_RULES = [
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

const CR_PDU_RULES = [
  ["CR-NET-RACK-PDU-A", "Network Rack PDU-A"],
  ["CR-NET-RACK-PDU-B", "Network Rack PDU-B"],
  ["CR-VW-RACK-PDU-A", "Videowall Rack PDU-A"],
  ["CR-VW-RACK-PDU-B", "Videowall Rack PDU-B"],
] as const;

const CR_BATTERY_RULES = [
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

const CR_HVAC_RULES = [
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

const CR_ENVIRONMENT_RULES = [
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

/** Seeds the three demo rules, but only onto an empty rules table. */
async function seedDemoRules(
  db: BmsDb,
  assetRows: readonly SeededAsset[],
): Promise<void> {
  const existingRules = await db
    .select({ id: automationRules.id })
    .from(automationRules)
    .limit(1);
  if (existingRules.length > 0) {
    return;
  }
  const upsAsset = assetRows.find((row) => row.code === "UPS-A") ?? assetRows[0];
  const cracAsset =
    assetRows.find((row) => row.code === "CH-CRAC-101") ?? assetRows[0];
  const pvAsset = assetRows.find((row) => row.code === "PV-INV-01") ?? assetRows[0];
  await db.insert(automationRules).values([
    {
      code: "demand_ceiling_notify",
      name: "Energy demand ceiling notification",
      description: "IF current demand is above 115 kW THEN notify Energy Manager.",
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

/** Seeds the twelve control-room breaker current-warning rules. */
async function seedCrBreakerRules(
  db: BmsDb,
  assetRows: readonly SeededAsset[],
): Promise<void> {
  for (const [assetCode, feederName] of CR_BREAKER_RULES) {
    const breakerAsset = assetRows.find((row) => row.code === assetCode);
    if (!breakerAsset) {
      continue;
    }
    const breakerNumber = assetCode.replace("CR-Q", "Q");
    const ruleCode =
      assetCode === "CR-Q9"
        ? "CR_Q9_VW_PDU_B_CURRENT_WARNING"
        : `${assetCode.replace("-", "_")}_CURRENT_WARNING`;
    await upsertRuleByCode(db, ruleCode, {
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
    });
  }
}

/** Seeds the four rack PDU utilisation-warning rules. */
async function seedCrPduRules(
  db: BmsDb,
  assetRows: readonly SeededAsset[],
): Promise<void> {
  for (const [assetCode, pduName] of CR_PDU_RULES) {
    const pduAsset = assetRows.find((row) => row.code === assetCode);
    if (!pduAsset) {
      continue;
    }
    await upsertRuleByCode(db, `${assetCode.replaceAll("-", "_")}_UTIL_WARNING`, {
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
    });
  }
}

/** Seeds the battery temperature and backup-runtime rules. */
async function seedCrBatteryRules(
  db: BmsDb,
  assetRows: readonly SeededAsset[],
): Promise<void> {
  for (const batteryRule of CR_BATTERY_RULES) {
    const batteryAsset = assetRows.find(
      (row) => row.code === batteryRule.assetCode,
    );
    if (!batteryAsset) {
      continue;
    }
    await upsertRuleByCode(db, batteryRule.code, {
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
}

/** Seeds the HVAC return-air and compressor-fault rules. */
async function seedCrHvacRules(
  db: BmsDb,
  assetRows: readonly SeededAsset[],
): Promise<void> {
  for (const hvacRule of CR_HVAC_RULES) {
    const hvacAsset = assetRows.find((row) => row.code === hvacRule.assetCode);
    if (!hvacAsset) {
      continue;
    }
    await upsertRuleByCode(db, hvacRule.code, {
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
}

/** Seeds the zone temperature, leak and smoke environment rules. */
async function seedCrEnvironmentRules(
  db: BmsDb,
  assetRows: readonly SeededAsset[],
): Promise<void> {
  for (const environmentRule of CR_ENVIRONMENT_RULES) {
    const environmentAsset = assetRows.find(
      (row) => row.code === environmentRule.assetCode,
    );
    if (!environmentAsset) {
      continue;
    }
    await upsertRuleByCode(db, environmentRule.code, {
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
}

/** Seeds every automation rule, in the order `seed.ts` originally ran them. */
export async function seedAutomationRules(
  db: BmsDb,
  assetRows: readonly SeededAsset[],
): Promise<void> {
  await seedDemoRules(db, assetRows);
  await seedCrBreakerRules(db, assetRows);
  await seedCrPduRules(db, assetRows);
  await seedCrBatteryRules(db, assetRows);
  await seedCrHvacRules(db, assetRows);
  await seedCrEnvironmentRules(db, assetRows);
}
