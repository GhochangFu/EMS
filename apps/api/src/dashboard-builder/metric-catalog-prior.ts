import { and, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { alarms, alarmSeverities } from "@bms/db";
import type { MetricCatalogKey, SustainabilityAggregate } from "@bms/shared";

import type { BmsTx } from "../database/tenant-context";
import { readRollupRows, rollup } from "./sustainability-rollup";

/**
 * `F4.317` (ADR 0112 decision 8) — "vs yesterday" on a catalog tile: the value of a catalog
 * metric at the same instant 24 h before the resolve, on the metric's own definition (ADR 0074
 * decision 5, the estate ribbon's rule; `dashboard/kpi-prior.ts` holds the estate's reads).
 *
 * **Only for a tile that asks** (owner ruling Q5): a `value_tile` whose config sets
 * `compareToPrevious`. `planResolves` folds the ask into the resolve key, so the same binding on
 * a tile that does not ask is a separate resolve that reads no prior and emits no `prior` key.
 *
 * Four entries have a prior read: the two alarm counts, `sustainability.total` and `pue.ratio`
 * — the four tiles of the organization strip that can show a delta. Every other entry ignores
 * the ask, and `PRIOR_KEYS` keeps it out of the resolve key so the ask costs it no second read.
 *
 * Every read takes the resolved, organization-bounded scope and writes its organization
 * predicate explicitly, as the live reads do (`metric-catalog.service.ts`' file docblock).
 */

/** The entries that read a prior when their tile asks. */
export const PRIOR_KEYS: ReadonlySet<MetricCatalogKey> = new Set<MetricCatalogKey>([
  "alarms.active.count",
  "alarms.critical.count",
  "sustainability.total",
  "pue.ratio",
]);

/**
 * Whether a widget asks for the prior: a `value_tile` whose stored config sets
 * `compareToPrevious: true` (`valueTileConfigSchema`). The stored config is `jsonb` and read as
 * `unknown`; anything but a literal `true` is "does not ask".
 */
export function widgetWantsPrior(widgetType: string, config: unknown): boolean {
  return (
    widgetType === "value_tile" &&
    typeof config === "object" &&
    config !== null &&
    (config as { readonly compareToPrevious?: unknown }).compareToPrevious === true
  );
}

/** The contract's `prior` field (`metricCatalogValueDtoSchema`'s metric arm). */
export function priorOf(at: Date, value: number | null): { readonly asOf: string; readonly value: number | null } {
  return { asOf: at.toISOString(), value };
}

/**
 * The alarms in scope that were open at `at`: raised by then (`raised_at <= at`) and not cleared
 * by then (`cleared_at IS NULL OR cleared_at > at`) — the estate `priorOpenAlarms` rule.
 * `criticalOnly` adds the `alarms.critical.count` predicate: severity tone `critical`. Never
 * null: `bms.alarms` is the whole history, so no row is zero. An empty scope is `0` before SQL.
 */
export async function priorOpenAlarmsInScope(
  tx: BmsTx,
  organizationId: string,
  scope: readonly string[],
  at: Date,
  criticalOnly: boolean,
): Promise<number> {
  if (scope.length === 0) return 0;
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(alarms)
    .where(
      and(
        eq(alarms.organizationId, organizationId),
        inArray(alarms.assetId, [...scope]),
        lte(alarms.raisedAt, at),
        or(isNull(alarms.clearedAt), gt(alarms.clearedAt, at)),
        criticalOnly
          ? inArray(
              alarms.severity,
              tx
                .select({ code: alarmSeverities.code })
                .from(alarmSeverities)
                .where(eq(alarmSeverities.tone, "critical")),
            )
          : undefined,
      ),
    );
  return row?.n ?? 0;
}

/**
 * `sustainability.total` at `at`: the same carrying assets and the same per-point freshness
 * bound as the live roll-up (`readRollupRows`, given the instant), aggregated the same way.
 * `null` when nothing was fresh then — a tile with no yesterday has nothing to compare with.
 */
export async function priorRollup(
  tx: BmsTx,
  organizationId: string,
  scope: readonly string[],
  params: {
    readonly pointKey: string;
    readonly aggregate: SustainabilityAggregate;
    readonly balanceRole?: string;
  },
  at: Date,
): Promise<number | null> {
  if (scope.length === 0) return null;
  const rows = await readRollupRows(tx, organizationId, scope, params.pointKey, params.balanceRole, at);
  return rollup(rows, params.aggregate).value;
}
