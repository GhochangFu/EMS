import { BadRequestException } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";

import { pointKeys, waterBalanceRoles } from "@bms/db";
import type { BmsDb } from "@bms/db";
import { METRIC_CATALOG } from "@bms/shared";
import type { MetricCatalogKey } from "@bms/shared";

import { boundedMissingPointKeys } from "../admin/asset-templates/asset-templates-cross-refs";
import { METRIC_CATALOG_PARAMS_WRITE } from "./dashboards.schema";

/**
 * `E4.2` U3 — the point key a catalog binding names must be an ACTIVE code of the point-key
 * catalog (ADR 0072 decision 2: "verified against `bms.point_keys` at write time — an unknown
 * code is a 400, the `assertPointKeysActive` rule at the binding").
 *
 * **Why the write path and not the schema.** `METRIC_CATALOG_PARAMS_WRITE` bounds and
 * charset-checks `pointKey`; whether the code EXISTS is a database fact, and a schema with no
 * connection cannot make it. Without this, a binding to `kl_todya` stores, the resolver finds
 * no carrying asset, and the tile shows "no value" forever with a green console — the `F4.43`
 * shape one column over.
 *
 * **Why the fleet pool.** The catalog is fleet-wide since `0057` (`F3.39`): a code is not an
 * organization's row, so there is no tenant GUC to set and nothing to leak. This is the same
 * lookup `AssetTemplatesService.assertPointKeysActive` makes, with the same message.
 *
 * **Two halves, so the pure one is testable without a connection** (§4.6, the `energy-cost.ts`
 * shape): `sourceParamsPointKeys` lifts the keys out of a submitted source list;
 * `assertSourceParamsPointKeysActive` runs the one `SELECT` and throws.
 *
 * **The file holds both vocabulary checks a catalog binding's params need.** `E4.3` / ADR 0073
 * decision 2 added the optional `balanceRole`, verified the same way against
 * `bms.water_balance_roles` (`sourceParamsBalanceRoles` / `assertSourceParamsBalanceRolesActive`):
 * a code that is only shape-valid narrows the carrying set to no asset, and the tile answers
 * `0/0` with a green console — the same silent failure one field over. The file keeps its name
 * so the two call sites' imports and the `E4.2` references stay true.
 */

/** The minimum of a submitted source this module reads. */
export type SubmittedSource = {
  readonly catalogKey: string;
  readonly params: unknown;
};

/**
 * The distinct `pointKey` strings of the sources whose `METRIC_CATALOG` entry declares
 * `params` and whose `params` parse under that entry's write schema, in first-seen order.
 *
 * A source whose params do NOT parse contributes nothing: on the dashboard write path the
 * schema has already refused it with a 400 naming the field, and on the template publish path
 * the caller parses first and throws its own 400 — so this function never throws, and never
 * reports a missing key for a binding that will not store anyway.
 */
export function sourceParamsPointKeys(sources: readonly SubmittedSource[]): string[] {
  return sourceParamsStrings(sources, "pointKey");
}

/**
 * The distinct `balanceRole` strings of the sources, in first-seen order — the same rules as
 * `sourceParamsPointKeys` (an entry with no `params`, or params that do not parse, contributes
 * nothing). A binding without the field contributes nothing either: the role is optional, and
 * its absence means "every carrying asset" (ADR 0073 decision 2).
 */
export function sourceParamsBalanceRoles(sources: readonly SubmittedSource[]): string[] {
  return sourceParamsStrings(sources, "balanceRole");
}

/** One string field lifted out of every source whose params parse under its entry's schema. */
function sourceParamsStrings(
  sources: readonly SubmittedSource[],
  field: "pointKey" | "balanceRole",
): string[] {
  const values = new Set<string>();
  for (const source of sources) {
    if (!(source.catalogKey in METRIC_CATALOG)) continue;
    const key = source.catalogKey as MetricCatalogKey;
    if (METRIC_CATALOG[key].params === undefined) continue;
    const parsed = METRIC_CATALOG_PARAMS_WRITE[key].safeParse(source.params);
    if (!parsed.success) continue;
    const value = (parsed.data as Record<string, unknown>)[field];
    if (typeof value === "string") values.add(value);
  }
  return [...values];
}

/**
 * Throws a 400 naming every point key the sources bind that is not an active catalog code.
 *
 * One `SELECT … WHERE active AND code = ANY(...)` on the fleet pool, skipped entirely when no
 * source names a key — the five Stage C entries cost nothing here. The message is bounded by
 * `boundedMissingPointKeys` for the reason that helper records, and it is word-for-word the
 * asset-template one so an author sees one sentence for one rule.
 */
export async function assertSourceParamsPointKeysActive(
  fleetDb: BmsDb,
  sources: readonly SubmittedSource[],
): Promise<void> {
  const codes = sourceParamsPointKeys(sources);
  if (codes.length === 0) return;

  const rows = await fleetDb
    .select({ code: pointKeys.code })
    .from(pointKeys)
    .where(and(eq(pointKeys.active, true), inArray(pointKeys.code, codes)));
  const active = new Set(rows.map((row) => row.code));
  const missing = boundedMissingPointKeys(codes.filter((code) => !active.has(code)));
  if (missing.length > 0) {
    throw new BadRequestException(`Not in the active point-key catalog: ${missing.join(", ")}`);
  }
}

/**
 * Throws a 400 naming every `balanceRole` the sources bind that is not an active
 * `bms.water_balance_roles` code (ADR 0073 decision 2).
 *
 * The `assertSourceParamsPointKeysActive` shape: one `SELECT … WHERE active AND code = ANY(...)`
 * on the fleet pool (the vocabulary is global, no tenant GUC), skipped when no source names a
 * role, and the message bounded by `boundedMissingPointKeys` — the bound is about the length
 * of a list of codes, not about point keys.
 */
export async function assertSourceParamsBalanceRolesActive(
  fleetDb: BmsDb,
  sources: readonly SubmittedSource[],
): Promise<void> {
  const codes = sourceParamsBalanceRoles(sources);
  if (codes.length === 0) return;

  const rows = await fleetDb
    .select({ code: waterBalanceRoles.code })
    .from(waterBalanceRoles)
    .where(and(eq(waterBalanceRoles.active, true), inArray(waterBalanceRoles.code, codes)));
  const active = new Set(rows.map((row) => row.code));
  const missing = codes.filter((code) => !active.has(code));
  if (missing.length > 0) {
    throw new BadRequestException(balanceRoleRefusalMessage(missing));
  }
}

/**
 * The 400's sentence for the roles that are not live, each echoed with its non-printable
 * characters stripped (review L1) — `VocabulariesService.unknownCodeMessage`'s rule. The write
 * schema bounds `balanceRole`'s length and deliberately not its charset, so a code carrying
 * `\r\n` reaches here and would otherwise split the line in a log sink. The strip runs before
 * `boundedMissingPointKeys`, so its cut bounds the string actually interpolated.
 */
export function balanceRoleRefusalMessage(missing: readonly string[]): string {
  const printable = missing.map((code) => code.replace(/[^\x20-\x7e]/g, ""));
  const shown = boundedMissingPointKeys(printable);
  return `Not a live water balance role: ${shown.join(", ")}`;
}
