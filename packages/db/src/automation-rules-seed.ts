import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";

import type { BmsDb } from "./client";
import type { SeededAsset } from "./eskom-assets-seed";
// The barrel, not `./schema/bms-schema`: `automationRules` moved to
// `schema/alarms-schema.ts` when the core file was split at the §4.5 cap.
import { assets, automationRules, locations, organizations } from "./schema";

/**
 * Rule Engine seed rows, split out of `seed.ts` to keep it under the
 * AGENTS.md §4.5 1000-line cap. Pure move: the control-room blocks all ran the
 * same select/update/insert sequence inline, which is now `upsertRuleByCode`.
 */

/**
 * Everything an automation rule row carries except its code and its
 * organization. `E7.1b`: `organizationId` is threaded to the seeders separately
 * (every rule here is ESKOM's) and stamped by `upsertRuleByCode`, so callers do
 * not repeat it on each rule literal.
 */
type AutomationRuleValues = Omit<
  typeof automationRules.$inferInsert,
  "code" | "organizationId"
>;

/**
 * Upserts one rule by code. The lookup reads the whole table on every call
 * rather than filtering in SQL because seeded codes were historically stored
 * with stray whitespace and mixed case; the comparison normalises both, and the
 * update rewrites the code to its canonical form.
 *
 * The five control-room seeders call it. Since `F4.169` the ESKOM ladder
 * path (`seedEskomLadderRules`) does not: a ladder code is built from an
 * operator-editable asset code, and this compare upper-cases only its stored
 * side, so a lowercase asset code missed it and a re-seed aborted with
 * `23505`.
 */
async function upsertRuleByCode(
  db: BmsDb,
  organizationId: string,
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
  await db.insert(automationRules).values({ code, organizationId, ...values });
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
  organizationId: string,
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
      organizationId,
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
      organizationId,
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
      organizationId,
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
  organizationId: string,
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
    await upsertRuleByCode(db, organizationId, ruleCode, {
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
  organizationId: string,
): Promise<void> {
  for (const [assetCode, pduName] of CR_PDU_RULES) {
    const pduAsset = assetRows.find((row) => row.code === assetCode);
    if (!pduAsset) {
      continue;
    }
    await upsertRuleByCode(db, organizationId, `${assetCode.replaceAll("-", "_")}_UTIL_WARNING`, {
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
  organizationId: string,
): Promise<void> {
  for (const batteryRule of CR_BATTERY_RULES) {
    const batteryAsset = assetRows.find(
      (row) => row.code === batteryRule.assetCode,
    );
    if (!batteryAsset) {
      continue;
    }
    await upsertRuleByCode(db, organizationId, batteryRule.code, {
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
  organizationId: string,
): Promise<void> {
  for (const hvacRule of CR_HVAC_RULES) {
    const hvacAsset = assetRows.find((row) => row.code === hvacRule.assetCode);
    if (!hvacAsset) {
      continue;
    }
    await upsertRuleByCode(db, organizationId, hvacRule.code, {
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
  organizationId: string,
): Promise<void> {
  for (const environmentRule of CR_ENVIRONMENT_RULES) {
    const environmentAsset = assetRows.find(
      (row) => row.code === environmentRule.assetCode,
    );
    if (!environmentAsset) {
      continue;
    }
    await upsertRuleByCode(db, organizationId, environmentRule.code, {
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

/**
 * The five ESKOM demo alarm-ladder checks, as `bms.automation_rules` rows —
 * same code convention (`ESKOM_<asset code, - to _>_<suffix>`, bounded to 64
 * characters by {@link ladderRuleCode} since `F4.129`), condition tuples and
 * severities as `packages/db/drizzle/0033_eskom_simulator_threshold_rules.sql`.
 *
 * Migration review (F3.6): migration `0033`'s own INSERTs join
 * `bms.assets`/`locations`/`organizations` to find ESKOM's electrical
 * assets, but those rows exist only because `pnpm db:seed` created them —
 * and `pnpm db:migrate` runs BEFORE seed. On a fresh database the join in
 * `0033` hits empty tables, every INSERT there writes zero rows, and
 * `drizzle` still marks it applied. This table is the seed-side source of
 * truth for the same five rules: a no-op (matched on `asset_id` and the
 * code's suffix since `F4.169`, see {@link seedEskomLadderRules}) on a
 * database where `0033` already seeded them, and the only path that creates
 * them on a fresh one.
 *
 * Exported since `F4.129` so `automation-rules-seed.spec.ts` iterates the
 * five real suffixes rather than restating them. `packages/db/src/index.ts`
 * does not re-export this module, so no public surface changes.
 */
export const ESKOM_LADDER_RULES = [
  {
    suffix: "VOLTAGE_CRITICAL",
    nameSuffix: "L1 voltage critical",
    description: "IF L1 voltage is at or above 239.5 V THEN raise a critical alarm.",
    category: "safety",
    pointKey: "voltage_l1_v",
    operator: "gte",
    thresholdValue: 239.5,
    severity: "critical",
    condition: { window: "latest", unit: "V", alarmMessage: "voltage_l1_critical" },
  },
  {
    suffix: "VOLTAGE_WARN",
    nameSuffix: "L1 voltage warning",
    description: "IF L1 voltage is at or above 237 V THEN raise a warning alarm.",
    category: "safety",
    pointKey: "voltage_l1_v",
    operator: "gte",
    thresholdValue: 237,
    severity: "warning",
    condition: { window: "latest", unit: "V", alarmMessage: "voltage_l1_high" },
  },
  {
    suffix: "BREAKER_OPEN",
    nameSuffix: "main breaker open",
    description: "IF main breaker status drops below 0.5 THEN raise a critical alarm.",
    category: "safety",
    pointKey: "breaker_main",
    operator: "lt",
    thresholdValue: 0.5,
    severity: "critical",
    condition: { window: "latest", alarmMessage: "breaker_main_open" },
  },
  {
    suffix: "DEMAND_HIGH",
    nameSuffix: "demand high",
    description: "IF current demand is above 115 kW THEN raise a warning alarm.",
    category: "energy",
    pointKey: "kw",
    operator: "gte",
    thresholdValue: 115,
    severity: "warning",
    condition: { window: "latest", unit: "kW" },
  },
  {
    suffix: "PF_LOW",
    nameSuffix: "power factor low",
    description: "IF power factor is below 0.82 THEN raise a warning alarm.",
    category: "energy",
    pointKey: "pf",
    operator: "lt",
    thresholdValue: 0.82,
    severity: "warning",
    condition: { window: "latest" },
  },
] as const;

/** `bms.automation_rules.code` is `varchar(64)` (`schema/alarms-schema.ts`). */
const RULE_CODE_MAX = 64;

/** The hex digits kept from the asset code's SHA-256, on overflow. */
const LADDER_HASH_WIDTH = 8;

/**
 * `F4.129` — the code for one ESKOM ladder rule, bounded to
 * `RULE_CODE_MAX` (64) characters whatever the asset code's length.
 *
 * The unbounded template is `ESKOM_${assetCode, - to _}_${suffix}` —
 * `7 + n + s` characters for an `n`-character asset code and an
 * `s`-character suffix. It is returned unchanged whenever that fits (`<=
 * RULE_CODE_MAX`), so every code seeded before `F4.129` keeps its bytes; a
 * 42+ character asset code otherwise aborts `pnpm db:seed` with Postgres
 * `22001 value too long`.
 *
 * On overflow the result is `ESKOM_<cut>_<hash>_<suffix>`: `<hash>` is the
 * first `LADDER_HASH_WIDTH` (8) hex digits of `sha256` of the full raw asset
 * code, uppercased, and `<cut>` is the folded asset code sliced to what the
 * other parts leave — `48 - s` characters, so the result is exactly 64.
 *
 * Three choices, each load-bearing:
 *
 * - **The hash is of the full, raw asset code.** Full, because two long codes
 *   that agree up to the cut produce the same `<cut>` and differ only in the
 *   tail the cut dropped. Raw (before the `-` → `_` fold), because `A-B…` and
 *   `A_B…` fold to the same `<cut>` and are still two assets.
 * - **`<hash>` is uppercase.** It was chosen for `upsertRuleByCode`, which
 *   upper-cases only the stored side of its compare. Since `F4.169` case
 *   decides no match: `seedEskomLadderRules` finds an already-seeded ladder
 *   rule by `asset_id` and suffix ({@link ladderSuffixOf}), never by this
 *   code, so a lowercase asset code, whose cut keeps its case, no longer
 *   aborts a re-seed with `23505`. The hash stays uppercase so that every
 *   code seeded under `F4.129` keeps its bytes.
 * - **`slice()` is exact**, not an approximation. Migration
 *   `0070_catalog_code_charset.sql` constrains `bms.assets.code` to
 *   `^[A-Za-z0-9_-]+$` — pure ASCII — so every asset code this reads is one
 *   UTF-16 code unit per character and `String.prototype.slice` never splits
 *   a surrogate pair (the `F4.104` lesson does not apply here).
 */
export function ladderRuleCode(assetCode: string, suffix: string): string {
  const folded = assetCode.replaceAll("-", "_");
  const raw = `ESKOM_${folded}_${suffix}`;
  if (raw.length <= RULE_CODE_MAX) {
    return raw;
  }
  const hash = createHash("sha256")
    .update(assetCode)
    .digest("hex")
    .toUpperCase()
    .slice(0, LADDER_HASH_WIDTH);
  // `ESKOM_` + `_` around the cut, then the hash, `_`, and the suffix.
  const cutWidth =
    RULE_CODE_MAX - "ESKOM__".length - LADDER_HASH_WIDTH - "_".length - suffix.length;
  const cut = folded.slice(0, cutWidth);
  return `ESKOM_${cut}_${hash}_${suffix}`;
}

/** One of the five `ESKOM_LADDER_RULES` suffixes. */
type LadderSuffix = (typeof ESKOM_LADDER_RULES)[number]["suffix"];

/**
 * `F4.169` — the `ESKOM_LADDER_RULES` suffix a stored rule code ends with,
 * as its `_`-delimited tail, or `null` when it ends with none of them.
 *
 * `seedEskomLadderRules` reads this, with the rule's `asset_id`, to decide
 * whether an asset already carries one of its five ladder rules. The tail is
 * the one part of a ladder code that neither the asset code (renamed, or
 * lower case) nor the `F4.129` hash-cut can change. No suffix is the
 * `_`-tail of another (`automation-rules-seed.spec.ts` gates that), so a
 * code matches at most one.
 */
export function ladderSuffixOf(code: string): LadderSuffix | null {
  const rule = ESKOM_LADDER_RULES.find((candidate) => code.endsWith(`_${candidate.suffix}`));
  return rule ? rule.suffix : null;
}

/** `bms.automation_rules.name` is `varchar(255)` (`schema/alarms-schema.ts`). */
const RULE_NAME_MAX = 255;

/**
 * `F4.129` — the name for one ESKOM ladder rule, `${assetName} ${nameSuffix}`,
 * bounded to `RULE_NAME_MAX` (255) characters. `bms.assets.name` is
 * `varchar(255)` as well, so without the bound an asset name of 236+
 * characters aborts `pnpm db:seed` with `22001`, the same failure as the code.
 *
 * The asset name is cut, never the suffix, and returned unchanged whenever the
 * whole name fits. No hash: rule names are not unique, so two cut names that
 * agree break nothing.
 *
 * The cut counts code points (`Array.from`), not UTF-16 code units: asset
 * names are free text with no charset check, Postgres counts a `varchar`
 * length in characters, and a code-unit `slice()` can split a surrogate pair
 * (the `F4.104` lesson, which does apply here).
 */
export function ladderRuleName(assetName: string, nameSuffix: string): string {
  const budget = RULE_NAME_MAX - " ".length - Array.from(nameSuffix).length;
  const characters = Array.from(assetName);
  const head = characters.length <= budget ? assetName : characters.slice(0, budget).join("");
  return `${head} ${nameSuffix}`;
}

/** A rule's condition, as the tuple `0033`'s own `NOT EXISTS` guards key on. */
function conditionKey(
  assetId: string,
  pointKey: string,
  operator: string,
  thresholdValue: number,
): string {
  return `${assetId}::${pointKey}::${operator}::${thresholdValue}`;
}

/**
 * One asset {@link seedEskomLadderRules} skipped at least one ladder rule for,
 * because a different rule already held the code (guard 3). `seed.ts` hands
 * the list to `verifyHierarchySeed`, which exempts exactly these assets from
 * its uncovered-asset check and logs each one it exempts.
 */
export type LadderCollisionSkip = { readonly assetId: string; readonly assetCode: string };

/**
 * Guard 1's test: a rule with a ladder condition's tuple stands in for that
 * ladder rule when it is published, enabled or not, of any source (owner
 * ruling 18). A draft or an archived rule does not.
 */
export function standsInForLadderRule(lifecycleStatus: string): boolean {
  return lifecycleStatus === "published";
}

/** One rule on an asset, as guards 1 and 2 and the boot gate read it. */
export type AssetRuleForLadder = {
  readonly code: string;
  readonly source: string;
  readonly lifecycleStatus: string;
  readonly pointKey: string | null;
  readonly operator: string | null;
  readonly thresholdValue: number | null;
};

/**
 * The ladder suffixes none of `assetRules` (one asset's rules) holds, by the
 * definition {@link seedEskomLadderRules} skips a ladder rule on (owner
 * ruling 19): a `simulator_threshold` rule whose code ends with the suffix
 * (guard 2), or a rule that {@link standsInForLadderRule} with the
 * condition's tuple (guard 1). The boot gate's uncovered-asset check counts
 * an asset for which this is not empty.
 */
export function ladderSuffixesNotHeld(assetRules: readonly AssetRuleForLadder[]): LadderSuffix[] {
  return ESKOM_LADDER_RULES.filter(
    (rule) =>
      !assetRules.some(
        (held) =>
          (held.source === "simulator_threshold" && ladderSuffixOf(held.code) === rule.suffix) ||
          (standsInForLadderRule(held.lifecycleStatus) &&
            held.pointKey === rule.pointKey &&
            held.operator === rule.operator &&
            held.thresholdValue === rule.thresholdValue),
      ),
  ).map((rule) => rule.suffix);
}

/**
 * Seeds the ESKOM ladder onto every electrical asset, skipping any of the
 * five rules wherever that asset already carries a published rule, enabled
 * or not, with the same `(asset_id, point_key, operator, threshold_value)`
 * condition — `0033`'s own condition-tuple `NOT EXISTS` guard, for all five
 * rules and not just `DEMAND_HIGH`, less drafts and archived rules (owner
 * rulings 15 and 18). That is what keeps `UPS-A`'s `demand_ceiling_notify`
 * (seeded above by `seedDemoRules`) from getting a duplicate
 * `ESKOM_UPS_A_DEMAND_HIGH` beside it — while that rule is published. An
 * administrator who archives it, or edits its condition, gets the ladder's
 * `ESKOM_UPS_A_DEMAND_HIGH` on the next boot.
 *
 * Code review and migration review, PR #100: an earlier draft keyed only
 * `DEMAND_HIGH` on the condition tuple and left the other four on
 * `upsertRuleByCode`'s code match. Asset `code` is operator-editable
 * (`apps/api/src/admin/assets/assets.schema.ts` has no case/charset
 * constraint on it) and `upsertRuleByCode` only case-folds its *stored* side
 * — a rename, or a lowercase code, generates a code that does not match the
 * existing row, so a re-seed inserted a second rule with the identical
 * condition (two `rule_id`s, so `alarms_open_per_rule_uidx` does not dedupe
 * them — the exact defect this item exists to close) or, for a duplicate
 * generated code, aborted `pnpm db:seed` on the `code` unique constraint.
 * Keying every rule on its condition tuple skips an already-seeded
 * condition outright, whatever code it was seeded under.
 *
 * `F4.169`: the condition tuple alone was not enough. Once an operator edits
 * a seeded rule's threshold, the tuple no longer matches, and the fallback
 * was still `upsertRuleByCode`'s code match — so a lowercase or renamed
 * asset code INSERTed its stored code again and `pnpm db:seed` aborted with
 * `23505` on `automation_rules_org_code_idx`. Each `(asset, ladder rule)` now
 * runs three guards, in order, and never updates a stored code:
 *
 * 1. **Condition tuple** (above), first, for the `UPS-A`
 *    `demand_ceiling_notify` case. Only a published rule counts, enabled or
 *    not, of any source ({@link standsInForLadderRule}, owner ruling 18): five
 *    draft operator rules with the ladder's tuples used to leave an asset with
 *    no ladder rule at all.
 * 2. **Asset and suffix.** The asset already carries a
 *    `source = 'simulator_threshold'` rule whose code's `_`-delimited tail
 *    is this rule's suffix ({@link ladderSuffixOf}). `asset_id` keeps
 *    `ups-a` and `UPS-A` apart and survives an asset rename; `source` is the
 *    ladder marker `0033` and this seed both write, and `ruleDraftBodySchema`
 *    has no `source` field, so an operator edit cannot clear it.
 * 3. **Code already held.** A different row in the organization already
 *    holds the code {@link ladderRuleCode} computes. That rule is skipped
 *    and `log` gets one line naming both assets by code and id, the code,
 *    and the holder's rule id; the rest of the seed runs. The check is a
 *    read made before the loop, never a caught `23505`: the seed runs in
 *    `withOrganization`'s one transaction, which a failed INSERT aborts
 *    (`25P02`).
 *
 * Otherwise the rule is INSERTed and its code joins the held set. A stored
 * code is never rewritten to a new asset code: the rewrite could itself hit
 * the unique index inside the seed transaction, and no reader keys on a
 * ladder code. The assets are read `ORDER BY created_at, code`, so which of
 * two colliding assets takes a held code is fixed.
 *
 * **Guard 3 has an ordinary cause, not only a crafted one: rename-and-reuse.**
 * An operator renames asset A from `OLD` to `NEW`; A keeps its five rules at
 * the `OLD` codes (guard 2). A new electrical asset B is then given `OLD`, so
 * all five of B's codes are held by A's rules and guard 3 skips all five. A
 * crafted asset code can do the same by holding one of another asset's
 * hashed codes, and several such assets can strip a victim of its ladder
 * rules. Neither case rewrites a code or invents a fallback code (owner
 * ruling 2); each skip is logged here.
 *
 * The function returns one {@link LadderCollisionSkip} per asset that lost
 * at least one rule to guard 3. `seed.ts` hands the list to
 * `verifyHierarchySeed`, whose uncovered-asset check exempts exactly those
 * assets, by id, and logs one line for each asset it exempts, so a
 * rename-and-reuse boots. The check counts an asset when any of the five
 * ladder conditions is held by neither guard 1 nor guard 2
 * ({@link ladderSuffixesNotHeld}, owner ruling 19), so a victim that lost
 * even one rule to guard 3 is uncovered, and exempt only because it is on
 * the list. An uncovered asset that is not on the list — one with no
 * collision — still stops the boot, and the `verify:hierarchy` CLI, which
 * passes no list, fails on every uncovered asset.
 *
 * One residual remains outside this function. `updateRule`
 * (`apps/api/src/rules/rules.service.ts`) accepts a new `code` for a
 * `simulator_threshold` rule: if an operator renames one so it no longer
 * ends `_${suffix}` and also edits its threshold, the next seed adds a second
 * rule with the original condition — not a boot failure.
 *
 * Queries `bms.assets`/`locations`/`organizations` directly — the same join
 * migration `0033` uses — rather than taking the eskom-assets-seed.ts
 * catalog as a parameter. Asset scoping mismatch, caught by testing this
 * against a fresh database: `ESK-MANUAL-01` (`access-fixtures-seed.ts`) is
 * an ESKOM electrical asset too, but it is not in that catalog and is
 * created by `seedAccessControlFixtures`, which `seed.ts` runs AFTER
 * `seedAutomationRules`. `seed.ts` therefore calls this function separately,
 * once every ESKOM electrical asset actually exists.
 *
 * `F4.129`: the code and the name the seed writes run through
 * {@link ladderRuleCode} and {@link ladderRuleName} rather than raw
 * templates, so an asset code of 42+ characters, or an asset name of 236+,
 * no longer aborts `pnpm db:seed` with `22001 value too long`. See those
 * functions' docblocks for the bounds.
 */
export async function seedEskomLadderRules(
  db: BmsDb,
  organizationId: string,
  log: (line: string) => void = (line) => console.error(line),
): Promise<LadderCollisionSkip[]> {
  const electricalAssets = await db
    .select({ id: assets.id, code: assets.code, name: assets.name })
    .from(assets)
    .innerJoin(locations, eq(locations.id, assets.locationId))
    .innerJoin(organizations, eq(organizations.id, locations.organizationId))
    .where(and(eq(organizations.code, "ESKOM"), eq(assets.domain, "electrical")))
    // A stated order, so which of two colliding assets takes a held code
    // (guard 3) does not depend on the plan.
    .orderBy(assets.createdAt, assets.code);
  if (electricalAssets.length === 0) {
    return [];
  }

  const existingRows = await db
    .select({
      assetId: automationRules.assetId,
      pointKey: automationRules.pointKey,
      operator: automationRules.operator,
      thresholdValue: automationRules.thresholdValue,
      lifecycleStatus: automationRules.lifecycleStatus,
      enabled: automationRules.enabled,
    })
    .from(automationRules);
  // Guard 1 counts a published rule, enabled or not, of any source (owner
  // ruling 18, which superseded the "enabled" half of ruling 15). A draft or
  // archived rule with a ladder tuple does not stand in for the ladder rule.
  // Each held condition maps to whether an enabled rule holds it, for the
  // log line below.
  const existingConditions = new Map<string, boolean>();
  for (const row of existingRows) {
    if (
      standsInForLadderRule(row.lifecycleStatus) &&
      row.assetId !== null &&
      row.pointKey !== null &&
      row.operator !== null &&
      row.thresholdValue !== null
    ) {
      const key = conditionKey(row.assetId, row.pointKey, row.operator, row.thresholdValue);
      existingConditions.set(key, (existingConditions.get(key) ?? false) || row.enabled);
    }
  }

  // `F4.169`: one read of the organization's rules, joined to their asset's
  // code for the collision warning. `automation_rules_org_code_idx` is
  // `(organization_id, code)`, byte-exact, so `codesHeld` is keyed on the
  // stored bytes and holds every rule in the organization, ladder or not.
  const organizationRules = await db
    .select({
      id: automationRules.id,
      code: automationRules.code,
      assetId: automationRules.assetId,
      assetCode: assets.code,
      source: automationRules.source,
    })
    .from(automationRules)
    .leftJoin(assets, eq(assets.id, automationRules.assetId))
    .where(eq(automationRules.organizationId, organizationId));
  const seededLadderRules = new Set<string>();
  const codesHeld = new Map<string, { id: string; assetId: string | null; assetCode: string | null }>();
  for (const row of organizationRules) {
    codesHeld.set(row.code, { id: row.id, assetId: row.assetId, assetCode: row.assetCode });
    const suffix = ladderSuffixOf(row.code);
    if (row.source === "simulator_threshold" && row.assetId !== null && suffix !== null) {
      seededLadderRules.add(`${row.assetId}::${suffix}`);
    }
  }

  // One entry per asset that lost at least one rule to guard 3, keyed on the
  // asset id, so an asset that loses all five is listed once.
  const collisionSkips = new Map<string, LadderCollisionSkip>();
  for (const asset of electricalAssets) {
    for (const rule of ESKOM_LADDER_RULES) {
      const heldEnabled = existingConditions.get(conditionKey(asset.id, rule.pointKey, rule.operator, rule.thresholdValue));
      if (heldEnabled !== undefined) {
        // Addendum 4: a skip only a published, disabled rule causes is logged,
        // since that asset raises no alarm on the condition until it is enabled.
        if (!heldEnabled && !seededLadderRules.has(`${asset.id}::${rule.suffix}`)) {
          log(
            `seedEskomLadderRules: skipped ${ladderRuleCode(asset.code, rule.suffix)} for asset ${asset.code} ` +
              `(${asset.id}): a published, disabled rule holds its condition`,
          );
        }
        continue;
      }
      if (seededLadderRules.has(`${asset.id}::${rule.suffix}`)) {
        continue;
      }
      const code = ladderRuleCode(asset.code, rule.suffix);
      const holder = codesHeld.get(code);
      if (holder) {
        log(
          `seedEskomLadderRules: skipped ${code} for asset ${asset.code} (${asset.id}): ` +
            `rule ${holder.id} on asset ${holder.assetCode ?? "<none>"} (${holder.assetId ?? "<none>"}) ` +
            `already holds that code`,
        );
        collisionSkips.set(asset.id, { assetId: asset.id, assetCode: asset.code });
        continue;
      }
      const [inserted] = await db
        .insert(automationRules)
        .values({
          code,
          organizationId,
          name: ladderRuleName(asset.name, rule.nameSuffix),
          description: rule.description,
          category: rule.category,
          ruleType: "threshold",
          source: "simulator_threshold",
          enabled: true,
          lifecycleStatus: "published",
          publishedAt: new Date(),
          assetId: asset.id,
          pointKey: rule.pointKey,
          operator: rule.operator,
          thresholdValue: rule.thresholdValue,
          severity: rule.severity,
          condition: rule.condition,
          action: { type: "notify", target: rule.category === "energy" ? "Energy Manager" : "Operations" },
        })
        .returning({ id: automationRules.id });
      codesHeld.set(code, { id: inserted.id, assetId: asset.id, assetCode: asset.code });
    }
  }
  return [...collisionSkips.values()];
}

/**
 * Seeds every automation rule, in the order `seed.ts` originally ran them.
 *
 * NOT `seedEskomLadderRules` — that one needs every ESKOM electrical asset
 * to exist first, including `ESK-MANUAL-01` (`access-fixtures-seed.ts`),
 * which `seed.ts` creates after this function runs. `seed.ts` calls it
 * separately, later in its own sequence.
 */
export async function seedAutomationRules(
  db: BmsDb,
  assetRows: readonly SeededAsset[],
  organizationId: string,
): Promise<void> {
  await seedDemoRules(db, assetRows, organizationId);
  await seedCrBreakerRules(db, assetRows, organizationId);
  await seedCrPduRules(db, assetRows, organizationId);
  await seedCrBatteryRules(db, assetRows, organizationId);
  await seedCrHvacRules(db, assetRows, organizationId);
  await seedCrEnvironmentRules(db, assetRows, organizationId);
}
