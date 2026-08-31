import type pg from "pg";

/**
 * `F4.69` — a `bms.asset_points` row for every point a published threshold rule
 * names, so the demo organization has tags that are both **ruled** and
 * **catalogued**.
 *
 * **Why this exists.** Three tables have to agree before an asset can be shown
 * a health score, and on the seeded demo only two of them ever did:
 *
 *  1. `bms.automation_rules` — 289 published threshold rules, every one bound to
 *     a concrete `(asset_id, point_key)`. Seeded by `automation-rules-seed.ts`.
 *  2. `telemetry.point_values` — written by `apps/sim` for the same assets, by
 *     domain. It needs no catalog row and never consulted one.
 *  3. `bms.asset_points` — the point catalog, which **nothing seeded for these
 *     assets at all**. Before this module the only rows belonged to the PHE
 *     pilot (252) and to one manual access fixture.
 *
 * `AssetHealthService.catalogPoints` reads (3), so a tag missing from it is
 * invisible to the score however much telemetry and however many rules it has —
 * ADR 0050's Context measured the overlap at **zero**, and the enterprise donut
 * read `SCORED 0 / 148`. `F3.35` hit the same hole from the other side: the
 * builder's point picker walks locations → `bms.asset_points`, so it could not
 * offer a point that had any history to chart.
 *
 * **The 16 `(asset, point)` pairs that already carried rollup data are not the
 * fix, and cataloguing them would be a mistake.** 15 of them are orphaned
 * integration-test rows on assets `bms.assets` no longer holds; the one real
 * pair carries no rule. This module works from the rules instead, which are
 * seeded, current and bound to live assets.
 *
 * **Nothing here tunes a threshold or a simulator profile, and that was
 * checked rather than assumed.** `stepEnvironment` free-walks `temperature_c`
 * with `rndWalk(prev, 0.08, 18, 31)`, so over a 24-hour window the value
 * diffuses across the whole band, while the six `CR-ENV-*` rules sit at 27, 27,
 * 28, 28, 30 and 30 — inside it. A realistic minority of samples therefore
 * falls out of range on its own. (`stepElectrical` re-centres on a profile
 * constant every tick, so the electrical rules would *not* have produced a
 * spread; the environment zones are the ones that demonstrate.)
 *
 * **`source_kind` is `unmapped`, with a NULL `rtu_id`.** That is what
 * `AssetPointsService.create` itself writes for a point with no gateway
 * (`sourceKind: sourceRtuId ? "measured" : "unmapped"`), and
 * `asset_points_source_ref_check` permits exactly that pairing. `manual` would
 * be wrong in a way an operator can see — it marks a hand-entered reading, and
 * these are written by the simulator.
 */

/**
 * The rules that earn a catalog row, written once and used by both statements.
 *
 * A literal in this file, never a caller's string. It is interpolated rather
 * than parameterized because the two statements must not be able to drift: a
 * seed that inserts for one predicate and verifies against another reports
 * success it has not established.
 */
const RULED_POINT_PREDICATE = `
      r.organization_id = $1
  AND r.rule_type = 'threshold'
  AND r.enabled = true
  AND r.lifecycle_status = 'published'
  AND r.asset_id IS NOT NULL
  AND r.point_key IS NOT NULL
`;

/**
 * `DISTINCT ON` rather than `DISTINCT`: two rules may name one
 * `(asset, point_key)` — `CR-BATT-1` carries both a temperature and a backup
 * rule on different keys, but nothing stops a second rule on the same key — and
 * the `ORDER BY` then makes the unit deterministic instead of arbitrary.
 *
 * `ON CONFLICT DO NOTHING` on the `(asset_id, point_key)` unique constraint, so
 * a re-seed is idempotent and an operator's own catalog row is never overwritten
 * by this module.
 */
export const RULED_POINT_CATALOG_SQL = `
INSERT INTO bms.asset_points
  (organization_id, asset_id, point_key, source_data_key, rtu_id, source_kind, unit, active)
SELECT DISTINCT ON (r.asset_id, r.point_key)
  $1::uuid,
  r.asset_id,
  r.point_key,
  'SIM_' || upper(r.point_key),
  NULL,
  'unmapped',
  pk.unit,
  true
FROM bms.automation_rules r
JOIN bms.assets a ON a.id = r.asset_id
LEFT JOIN bms.point_keys pk
  ON pk.organization_id = r.organization_id
 AND pk.code = r.point_key
 AND pk.active = true
WHERE ${RULED_POINT_PREDICATE}
ORDER BY r.asset_id, r.point_key, pk.unit NULLS LAST
ON CONFLICT (asset_id, point_key) DO NOTHING
`;

/**
 * The post-condition, and the reason it is a `SELECT` and not a `rowCount`.
 *
 * The seed connects as `bms_owner` under `FORCE ROW LEVEL SECURITY`. A write
 * that the policy declines to accept can leave fewer rows than the `SELECT`
 * offered **with no error at all**, so "the INSERT did not throw" establishes
 * nothing about how many rows exist. This asks the question the caller actually
 * has — is any ruled point still uncatalogued — and throws with the count.
 */
export const UNCATALOGUED_RULED_POINTS_SQL = `
SELECT count(*)::int AS missing
FROM bms.automation_rules r
WHERE ${RULED_POINT_PREDICATE}
  AND NOT EXISTS (
    SELECT 1 FROM bms.asset_points ap
    WHERE ap.asset_id = r.asset_id AND ap.point_key = r.point_key
  )
`;

/**
 * Catalogs every ruled point of one organization, and proves it did.
 *
 * Runs inside the caller's tenant context — `seed.ts` calls it from the ESKOM
 * `withOrganization` bracket, after `seedEskomLadderRules`, so the ladder rules'
 * points are catalogued too.
 *
 * @returns the number of rows this call inserted. Zero is the correct answer on
 * a re-seed and is not a failure; the post-condition is what fails.
 */
export async function seedRuledPointCatalog(
  pool: pg.Pool,
  organizationId: string,
): Promise<number> {
  const inserted = await pool.query(RULED_POINT_CATALOG_SQL, [organizationId]);

  const check = await pool.query<{ missing: number }>(UNCATALOGUED_RULED_POINTS_SQL, [
    organizationId,
  ]);
  const missing = check.rows[0]?.missing ?? -1;
  if (missing !== 0) {
    throw new Error(
      `seedRuledPointCatalog: ${missing} published threshold rule(s) still name an ` +
        "uncatalogued point after the insert. A FORCE-RLS write can drop rows without " +
        "raising, so this is checked rather than inferred from the statement completing.",
    );
  }

  return inserted.rowCount ?? 0;
}
