import { asc, eq, inArray } from "drizzle-orm";

import { pointKeys, templatePoints } from "@bms/db";
import type { BmsDb } from "@bms/db";

import type { StoredTemplatePoint } from "./template-version-delta";

/**
 * `F4.312` (plan task 1.2) — the three reads of one template version that
 * `AssetTemplateMigrationService` held as private methods, moved here whole so
 * `AssetTemplateAdoptionService` reads a version exactly as migrate does.
 * Behaviour is byte-identical: the same projection, the same order, the same
 * non-refusing catalog read. Each takes the **fleet** db, for the E7.1b reason
 * each docblock below states — the callers apply the writable-scope grant
 * before reading.
 */

/**
 * `template_points.id` by point key, for one version.
 *
 * A second, narrow read rather than a column on {@link loadPoints}: that
 * projection is "the subset of a stored row `computeTemplateVersionDelta`
 * reads", and the id is not one of them — widening it would put a field on
 * the delta's input type that the delta never looks at. Read once per plan,
 * on the same `fleetDb` and for the same E7.1b reason as every other
 * `template_points` read here.
 */
export async function pointIdsByKey(
  fleetDb: BmsDb,
  templateId: string,
): Promise<Map<string, string>> {
  const rows = await fleetDb
    .select({ id: templatePoints.id, pointKey: templatePoints.pointKey })
    .from(templatePoints)
    .where(eq(templatePoints.templateId, templateId));
  return new Map(rows.map((row) => [row.pointKey, row.id]));
}

export async function loadPoints(
  fleetDb: BmsDb,
  templateId: string,
): Promise<StoredTemplatePoint[]> {
  // E7.1b: `template_points` read on `fleetDb` — a `FORCE`d tenant table in
  // `0047`. The delta this feeds decides what to migrate; a silent zero-point
  // read would compute an empty delta and migrate nothing.
  const rows = await fleetDb
    .select()
    .from(templatePoints)
    .where(eq(templatePoints.templateId, templateId))
    .orderBy(asc(templatePoints.sortOrder), asc(templatePoints.pointKey));
  return rows.map((row) => ({
    pointKey: row.pointKey,
    kind: row.kind,
    sourceDataKeyPattern: row.sourceDataKeyPattern,
    required: row.required,
    unit: row.unit,
    formula: row.formula,
    formulaDialect: row.formulaDialect,
    calcTrigger: row.calcTrigger,
    calcIntervalSeconds: row.calcIntervalSeconds,
    maxInputAgeSeconds: row.maxInputAgeSeconds,
    // `F2.9` finding 31. Projected because the delta compares it: a version
    // bump that moves only the ratio used to produce an empty
    // `derivedChanged`, so `migration-preview` said "no changes" while the
    // migrated asset picked the new value up on its next sweep.
    minCoverageRatio: row.minCoverageRatio,
    // `F2.24` — the five metadata defaults, projected because the delta compares
    // them; one left out reads `undefined` on both sides and goes unreported.
    scaleMultiplier: row.scaleMultiplier,
    scaleOffset: row.scaleOffset,
    engMin: row.engMin,
    engMax: row.engMax,
    qualityPolicy: row.qualityPolicy,
  }));
}

/**
 * Catalog units for the target version's point keys.
 *
 * Unlike instantiation this does **not** refuse a key that has left the
 * active catalog. Instantiation is creating equipment and can insist the
 * catalog is current; a migration is moving equipment that already exists,
 * and refusing it because an unrelated key was deactivated would strand the
 * estate on an old version for a reason the operator cannot fix from here.
 * A missing unit falls back to null, which is what the column already means.
 * `F4.312`: adoption reads the catalog the same way (owner ruling 4,
 * 2026-11-05 — an inactive catalog key does not refuse adoption).
 */
export async function catalogUnits(
  fleetDb: BmsDb,
  points: readonly StoredTemplatePoint[],
): Promise<Map<string, string | null>> {
  const codes = [...new Set(points.map((p) => p.pointKey))];
  if (codes.length === 0) {
    return new Map();
  }
  const rows = await fleetDb
    .select({ code: pointKeys.code, unit: pointKeys.unit })
    .from(pointKeys)
    // `F3.39`: fleet-wide catalog, so the lookup is by code alone.
    .where(inArray(pointKeys.code, codes));
  return new Map(rows.map((row) => [row.code, row.unit]));
}
