import type { TemplateContent } from "@bms/shared";
import type pg from "pg";

/**
 * `F4.75` — a published asset template per domain, carrying the health bands,
 * with every demo asset pinned to the one for its own domain.
 *
 * **Why this exists.** `F4.69` made the score demonstrable and `F4.74` made the
 * empty pie legible; neither made the pie *draw*. A band comes from exactly one
 * place — `AssetHealthService.healthForAssets` reads
 * `assets.template_id → asset_templates.content.health` — and on 2026-08-31 the
 * running stack held **0 templates** with **0 of 148 assets** pinned to one. So
 * every scored asset reported `band: null`, the donut's `bandCounts` was `[]`,
 * and the enterprise surface read `SCORED 71 / 148 · UNBANDED 71 · MEAN SCORE
 * 95%` with nothing drawn beside it. That is ADR 0050 Amendment 1 decision 3
 * working as ruled — bands have no default, because inventing cut-points puts a
 * fabricated *Excellent* on an executive screen — and it is why the cut-points
 * have to be *seeded* rather than defaulted.
 *
 * **Four templates, not one, and that is forced rather than chosen.**
 * `asset_templates.domain` is a foreign key to `bms.asset_domains`, and the 71
 * scored assets span all four domains the seed uses (electrical 50, environment
 * 14, it 4, hvac 3). One template can carry one domain, so pinning every asset
 * to a single row would mean pinning a chiller to an electrical template — a
 * mismatch no constraint catches and every reader has to un-learn. ADR 0031
 * Amendment 1 already ruled the other direction of the same pair: instantiation
 * copies the template's domain onto the asset precisely so the two cannot
 * disagree.
 *
 * **Each template declares points, because `publish()` refuses one that does
 * not.** `AssetTemplatesService.publish` throws *"A template with no points
 * would instantiate assets with no telemetry mapping"* on an empty point list,
 * so a pointless published row is data the application itself would decline to
 * create. The points are read from `bms.asset_points` — the catalog
 * `seedRuledPointCatalog` writes immediately before this module — so the
 * template declares the tags its domain's assets *actually carry*, never a
 * hand-listed set that can drift from them.
 *
 * **The declared points are optional and carry no `source_data_key_pattern`,
 * deliberately.** These templates exist to carry bands for assets that already
 * exist; they are not wiring templates. A literal pattern such as `SIM_KW` has
 * no `{asset_code}` token, so instantiating two assets from one of these rows
 * would map both onto one telemetry stream — the aliasing
 * `asset-templates-instantiate.service.ts` reserves `asset_code` to prevent. A
 * `{asset_code}` pattern would be worse: it would claim a key `apps/sim` does
 * not write. With `required = false` and a NULL pattern, `planAsset` skips the
 * point and **reports** it, which is the only honest third option.
 *
 * **Nothing here reaches ADR 0039's override merge.** `calc-definitions.service`
 * joins `template_points` with `WHERE kind = 'derived'`, and every point written
 * here is `measured`, so `coalesce(asset_points.<col>, template_points.<col>)`
 * gains no right-hand side. `listCalcPoints` filters on `derived` too and still
 * returns `{ items: [] }` for a pinned asset. The one behaviour that does change
 * is `updateCalcOverride`'s refusal message, from *"created by hand and is
 * pinned to no template version"* to *"the template version this asset is pinned
 * to does not declare point X"* — both refuse, and the second is the more
 * accurate sentence once the asset is pinned.
 */

/**
 * The client's five names (ADR 0050 Context), as ordered cut-points.
 *
 * `minScore` is the **inclusive lower bound in `0..1`**, and the list descends
 * strictly with the last band at `0` — the two rules `templateHealthSchema`
 * enforces on the write path, so that every score in `0..1` lands in exactly one
 * band and `band: null` keeps the single meaning Amendment 1 decision 3 gives
 * it. `asset-template-health-seed.spec.ts` in `apps/api` parses this literal
 * with that schema rather than restating the rules here.
 *
 * The values are conventional rather than tuned. Against the counters the
 * running stack held on 2026-08-31 they put all 71 scored assets into a band and
 * spread them across all five, most of the estate in Excellent and Good — which
 * is what a demo of a healthy plant should look like. The exact split is not
 * quoted here on purpose: it depends on the trailing window `resolveWindow`
 * selects, so any figure written down would be a number nobody can reproduce
 * from the seed alone.
 */
export const HEALTH_BANDS = [
  { code: "excellent", label: "Excellent", minScore: 0.95 },
  { code: "good", label: "Good", minScore: 0.85 },
  { code: "fair", label: "Fair", minScore: 0.7 },
  { code: "poor", label: "Poor", minScore: 0.5 },
  { code: "critical", label: "Critical", minScore: 0 },
] as const;

/**
 * The `content` every baseline template carries.
 *
 * **No `weights`.** An omitted weight is `1.0` (ADR 0050 Amendment 1 decision
 * 3), and equal weighting is the only defensible default for a domain baseline:
 * a weight is an author's judgement that one tag matters more than another on
 * *this class of equipment*, and the seed has no such judgement to record. It is
 * also a reference — `collectContentPointRefs` walks `health.weights`' keys — so
 * a weight here would have to name a declared point and would then be a second
 * thing to keep in step with the catalog.
 */
export const HEALTH_BASELINE_CONTENT: TemplateContent = {
  contentVersion: 1,
  health: { bands: HEALTH_BANDS.map((band) => ({ ...band })) },
};

/**
 * `BASELINE-ELECTRICAL`, `BASELINE-HVAC`, and so on — one per domain that has an
 * active asset.
 *
 * Written as an expression rather than a literal list so the set follows the
 * seeded estate: a domain added to `bms.assets` later gets a template on the
 * next seed, and a domain with no assets (`water`, today) gets none. The
 * `name` comes from `bms.asset_domains.label` for the same reason —
 * `initcap('hvac')` would render *Hvac*.
 */
const TEMPLATE_CODE_EXPR = `'BASELINE-' || upper(a.domain)`;

/**
 * The `asset_type` these rows carry, written once and used by both the insert
 * and the post-condition.
 *
 * Interpolated rather than repeated for the reason `ruled-point-catalog-seed`
 * gives for sharing its predicate: the check selects the rows it verifies **by**
 * this value, so an insert that wrote a different one would leave the
 * post-condition inspecting zero rows and reporting success it has not
 * established. One literal, two statements, and they cannot drift.
 *
 * `'baseline'` rather than a per-domain type because that is what these are —
 * one class of thing, four domains — and `asset_templates_org_asset_type_idx`
 * groups the picker by it.
 */
const TEMPLATE_ASSET_TYPE = "baseline";

/**
 * One published template per domain, version 1.
 *
 * `ON CONFLICT DO NOTHING` on `(organization_id, code, version)`, so a re-seed
 * is idempotent — and `DO NOTHING` rather than `DO UPDATE` because a published
 * version is **immutable** (ADR 0015): editing one creates a new draft at
 * `max(version) + 1`. A seed that overwrote published content would break the
 * one guarantee `assets.template_id` exists to give, since an asset pins the
 * version and would silently acquire different bands.
 */
export const HEALTH_TEMPLATE_SQL = `
INSERT INTO bms.asset_templates
  (organization_id, code, version, name, asset_type, domain, description, status,
   content, published_at)
SELECT DISTINCT
  $1::uuid,
  ${TEMPLATE_CODE_EXPR},
  1,
  d.label || ' Baseline',
  '${TEMPLATE_ASSET_TYPE}',
  a.domain,
  'Seeded demo baseline. Carries the health bands E1.3 renders, and declares the points this domain''s assets already carry.',
  'published',
  $2::jsonb,
  now()
FROM bms.assets a
JOIN bms.asset_domains d ON d.code = a.domain
WHERE a.organization_id = $1
  AND a.active = true
ON CONFLICT (organization_id, code, version) DO NOTHING
`;

/**
 * Every point key a domain's assets carry, declared on that domain's template.
 *
 * Read from `bms.asset_points` rather than from `bms.automation_rules`: the
 * catalog is what `AssetHealthService.catalogPoints` reads and what the builder's
 * point picker walks, so a template built from it declares the same tags the
 * rest of the product already agrees the asset has. `seedRuledPointCatalog` runs
 * immediately before this module and is what puts them there.
 *
 * `DISTINCT ON` with the `ORDER BY` because one point key can appear on many
 * assets of a domain, and `backup_min` appears twice on one asset with different
 * source keys (`MANUAL_BACKUP_MIN` and `SIM_BACKUP_MIN`) — the order makes the
 * chosen row deterministic instead of arbitrary, even though nothing here reads
 * the source key.
 *
 * `unit` stays NULL: it is an *override* of the catalog unit, and there is
 * nothing to override.
 */
export const HEALTH_TEMPLATE_POINTS_SQL = `
INSERT INTO bms.template_points
  (organization_id, template_id, point_key, unit, kind, source_data_key_pattern,
   required, sort_order)
SELECT DISTINCT ON (t.id, ap.point_key)
  $1::uuid,
  t.id,
  ap.point_key,
  NULL,
  'measured',
  NULL,
  false,
  0
FROM bms.asset_points ap
JOIN bms.assets a ON a.id = ap.asset_id
JOIN bms.asset_templates t
  ON t.organization_id = $1
 AND t.code = ${TEMPLATE_CODE_EXPR}
 AND t.version = 1
WHERE ap.organization_id = $1
  AND ap.active = true
  AND a.active = true
ORDER BY t.id, ap.point_key, ap.source_data_key
ON CONFLICT (template_id, point_key) DO NOTHING
`;

/**
 * Pins each active asset to its own domain's baseline.
 *
 * `template_id IS NULL` guards it: this module owns the pin's *existence*, never
 * its target. An asset an operator has migrated to another template (ADR 0039's
 * explicit, previewed and audited path) keeps that pin across a re-seed, which
 * is the same rule `DO NOTHING` gives the rows above.
 *
 * `t.domain = a.domain` is redundant against the code expression and is written
 * anyway: it is the invariant the post-condition below checks, and a reader
 * should find it stated in the statement that establishes it.
 */
export const HEALTH_TEMPLATE_PIN_SQL = `
UPDATE bms.assets a
SET template_id = t.id
FROM bms.asset_templates t
WHERE a.organization_id = $1
  AND a.active = true
  AND a.template_id IS NULL
  AND t.organization_id = $1
  AND t.domain = a.domain
  AND t.code = ${TEMPLATE_CODE_EXPR}
  AND t.version = 1
`;

/**
 * The post-condition, and the reason it is a `SELECT` and not a `rowCount`.
 *
 * The seed connects as `bms_owner` under `FORCE ROW LEVEL SECURITY`, where a
 * write the policy declines can leave fewer rows than the statement offered
 * **with no error at all** — `F4.73` measured exactly that on a read, and
 * `seedRuledPointCatalog` records it on a write. "The UPDATE did not throw"
 * therefore establishes nothing about how many assets are pinned.
 *
 * `unusable` is the second half, and it is the one a static test cannot reach:
 * `packages/db` cannot import `templateContentSchema` (it lives in `apps/api`),
 * so a malformed health block would write cleanly, `parseHealth` would return
 * `undefined`, every band would be `null`, and the donut would stay exactly as
 * empty as before while this module reported success. The two conditions checked
 * are the two that make `resolveBand` return `null`: no bands at all, and a
 * lowest band that does not start at `0`. The point count is checked beside them
 * because it is what `publish()` refuses.
 */
export const HEALTH_TEMPLATE_VERIFY_SQL = `
SELECT
  (
    SELECT count(*)::int
    FROM bms.assets a
    WHERE a.organization_id = $1
      AND a.active = true
      AND NOT EXISTS (
        SELECT 1 FROM bms.asset_templates t
        WHERE t.id = a.template_id AND t.domain = a.domain
      )
  ) AS unpinned,
  (
    SELECT count(*)::int
    FROM bms.asset_templates t
    WHERE t.organization_id = $1
      AND t.asset_type = '${TEMPLATE_ASSET_TYPE}'
      AND (
           t.status <> 'published'
        OR coalesce(jsonb_array_length(t.content -> 'health' -> 'bands'), 0) < 1
        OR (t.content -> 'health' -> 'bands' -> -1 ->> 'minScore')::numeric IS DISTINCT FROM 0
        OR NOT EXISTS (SELECT 1 FROM bms.template_points tp WHERE tp.template_id = t.id)
      )
  ) AS unusable
`;

/**
 * Seeds the baseline templates, pins the assets, and proves both.
 *
 * Runs inside the caller's tenant context — `seed.ts` calls it from the ESKOM
 * `withOrganization` bracket, after `seedRuledPointCatalog`, whose catalog rows
 * are what the point declaration reads.
 *
 * @returns how many templates and how many pins this call wrote. Zero and zero
 * is the correct answer on a re-seed and is not a failure; the post-condition is
 * what fails.
 */
export async function seedAssetTemplateHealth(
  pool: pg.Pool,
  organizationId: string,
): Promise<{ templates: number; pinned: number }> {
  const content = JSON.stringify(HEALTH_BASELINE_CONTENT);
  const templates = await pool.query(HEALTH_TEMPLATE_SQL, [organizationId, content]);
  await pool.query(HEALTH_TEMPLATE_POINTS_SQL, [organizationId]);
  const pinned = await pool.query(HEALTH_TEMPLATE_PIN_SQL, [organizationId]);

  const check = await pool.query<{ unpinned: number; unusable: number }>(
    HEALTH_TEMPLATE_VERIFY_SQL,
    [organizationId],
  );
  const unpinned = check.rows[0]?.unpinned ?? -1;
  const unusable = check.rows[0]?.unusable ?? -1;
  if (unpinned !== 0 || unusable !== 0) {
    throw new Error(
      `seedAssetTemplateHealth: ${unpinned} active asset(s) are pinned to no template of their ` +
        `own domain, and ${unusable} baseline template(s) cannot produce a band. A FORCE-RLS ` +
        "write can drop rows without raising, and a malformed health block reads back as no " +
        "band at all, so both are checked rather than inferred from the statements completing.",
    );
  }

  return { templates: templates.rowCount ?? 0, pinned: pinned.rowCount ?? 0 };
}
