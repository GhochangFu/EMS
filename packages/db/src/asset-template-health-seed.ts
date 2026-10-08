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
 * **Five domain baselines, not one, and that is forced rather than chosen.**
 * `asset_templates.domain` is a foreign key to `bms.asset_domains`, and the 71
 * scored assets span four domains (electrical 50, environment 14, it 4, hvac
 * 3). Since `E4.3` U11 the seed has a fifth domain, `water`: the five demo
 * water plant assets (`water-plant-demo-seed.ts`), so `BASELINE-WATER` exists
 * too. It declares nine points (the demo's distinct flow keys) and pins no
 * asset, because the demo pins its five assets to their `DEMO-WATER-*` mirrors
 * before this module runs. One template can carry one domain, so pinning every asset
 * to a single row would mean pinning a chiller to an electrical template — a
 * mismatch no constraint catches and every reader has to un-learn. ADR 0031
 * Amendment 1 already ruled the other direction of the same pair: instantiation
 * copies the template's domain onto the asset precisely so the two cannot
 * disagree. One more `BASELINE-*` row exists since `F2.8` —
 * `BASELINE-ELECTRICAL-INCOMER`, written by `pue-demo-seed.ts` *after* this
 * module. It is not a domain baseline: it carries the same bands and the same
 * seven measured points as `BASELINE-ELECTRICAL`, plus three `bms-calc-v2`
 * derived points, and only the nine `incoming-supply` assets move to it. This
 * module never writes to it (its code is not `'BASELINE-' || upper(domain)`)
 * and never moves an asset off it (the pin below guards on `template_id IS
 * NULL`).
 *
 * **And since `F2.32`, a baseline per domain AND role (ADR 0058 Amendment 3).**
 * A domain baseline declares the union of its domain's keys, so a transformer
 * pinned to `BASELINE-ELECTRICAL` was offered `backup_min` by the rule picker
 * (Amendment 2 measured 41 assets on a row of 8 keys; that figure is
 * superseded). The class axis already exists on data —
 * `bms.asset_group_members.role`, written by `demoRoleForAsset` and already
 * the PUE pin's selector — so this module also writes one
 * `BASELINE-<DOMAIN>-<ROLE>` per `(domain, role)` whose assets carry a point,
 * declaring only that class's keys, and pins a roled asset to it before the
 * domain pin runs. The domain baseline stays, unchanged, as the fallback for
 * an unroled asset and for a role whose assets carry no point. Two choices in
 * that sentence are deliberate. The role is `min(role)` over the asset's
 * memberships, so an asset with two roles still has one class. And the
 * template set does not depend on where the assets are pinned, so the five
 * water classes get role templates that pin nothing, exactly as
 * `BASELINE-WATER` already does: a set that followed the pins would differ
 * between a cold and a re-seeded database.
 *
 * **A database seeded before `F2.32` is re-pinned (ruling Q2), and the
 * statement runs on every seed, not once.** `HEALTH_ROLE_TEMPLATE_REPIN_SQL`
 * moves any active asset of the seeded org from version 1 of its own
 * `BASELINE-<DOMAIN>` to its role template when that template exists. The seed
 * is *not* the only writer of that pin: an operator can instantiate from the
 * baseline row, and migrate checks the code but not the direction, so it can
 * move an asset back to version 1. Such an asset is moved at the next seed if
 * it has a role (which `seedAssetGroups` fills on every boot), with no audit row.
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
 * next seed, and a domain with no active asset gets none. (`water` had none
 * until `E4.3` U11; it now has the five demo assets, so `BASELINE-WATER` is
 * written.) The
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
 * one class of thing, one row per domain — and `asset_templates_org_asset_type_idx`
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
 *
 * **`source_kind <> 'computed'` (`F2.8`, plan §11 decision 8).** The calc
 * engine's `CalcWriteService` creates a `computed` catalog row for every
 * derived point the first time it writes it — for the demo, `site_kw`,
 * `it_kw` and `pue` on each of the nine incomers. Those rows are the engine's
 * *outputs*; read back here without the predicate, the next `compose up`
 * would declare all three as MEASURED points on `BASELINE-ELECTRICAL`, the
 * template the other 41 electrical assets stay pinned to. Nothing would fail:
 * `publish()` is not involved, the FK holds, and the baseline would simply
 * claim three tags no electrical asset carries. The predicate is what keeps
 * the engine's own rows from feeding back into a baseline through the seed,
 * and `asset-template-health-seed.spec.ts` pins it by its exact text.
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
  AND ap.source_kind <> 'computed'
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
 * The asset's class: the smallest role among its group memberships, or NULL
 * for an asset with no role. `min` makes the choice deterministic for an asset
 * that holds several. `asset_group_members` has no organization column; the
 * read is bounded through `a`, which every statement below bounds to `$1`.
 */
const ROLE_EXPR = `(SELECT min(agm.role) FROM bms.asset_group_members agm WHERE agm.asset_id = a.id)`;

/**
 * `F2.32` (ADR 0058 Amendment 3) — `BASELINE-ELECTRICAL-TRANSFORMER`,
 * `BASELINE-IT-IT_RACK`, and so on. Hyphens in the role become underscores so
 * the code still splits on its last hyphen into domain and class. NULL for an
 * unroled asset, and a NULL code matches no template, so such an asset falls
 * through to the domain pin.
 *
 * **One expression, five statements.** The template insert, its points, the
 * pin, the re-pin and the verify all name the role template through this
 * value. If two of them drifted, a template would be written that no pin
 * finds, or the verify would inspect a different template from the one the
 * re-pin moved assets to, and report a success it had not established.
 */
export const ROLE_TEMPLATE_CODE_EXPR = `('BASELINE-' || upper(a.domain) || '-' || upper(replace(${ROLE_EXPR}, '-', '_')))`;

/**
 * One published role template per `(domain, role)` whose active assets carry
 * an active, non-computed point — the same rows `HEALTH_ROLE_TEMPLATE_POINTS_SQL`
 * reads, so every row written here gets at least one point and `unusable`
 * cannot trip on a pointless class. `DO NOTHING` for the reason
 * `HEALTH_TEMPLATE_SQL` gives.
 */
export const HEALTH_ROLE_TEMPLATE_SQL = `
INSERT INTO bms.asset_templates
  (organization_id, code, version, name, asset_type, domain, description, status,
   content, published_at)
SELECT DISTINCT
  $1::uuid,
  c.code,
  1,
  d.label || ' ' || r.label || ' Baseline',
  '${TEMPLATE_ASSET_TYPE}',
  c.domain,
  'Seeded demo baseline for one class of asset. Carries the health bands E1.3 renders, and declares only the points this class''s assets already carry.',
  'published',
  $2::jsonb,
  now()
FROM (
  SELECT a.domain, ${ROLE_EXPR} AS role, ${ROLE_TEMPLATE_CODE_EXPR} AS code
  FROM bms.assets a
  WHERE a.organization_id = $1
    AND a.active = true
    AND EXISTS (
      SELECT 1 FROM bms.asset_points ap
      WHERE ap.asset_id = a.id
        AND ap.organization_id = $1
        AND ap.active = true
        AND ap.source_kind <> 'computed'
    )
) c
JOIN bms.asset_domains d ON d.code = c.domain
JOIN bms.asset_roles r ON r.code = c.role
WHERE c.code IS NOT NULL
ON CONFLICT (organization_id, code, version) DO NOTHING
`;

/**
 * Every point key a class's assets carry, declared on that class's template.
 * The body is `HEALTH_TEMPLATE_POINTS_SQL`'s, joined through the role instead
 * of the domain, so it keeps the `computed` predicate (`F2.8`) and the
 * no-wiring shape for the same reasons.
 */
export const HEALTH_ROLE_TEMPLATE_POINTS_SQL = `
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
 AND t.code = ${ROLE_TEMPLATE_CODE_EXPR}
 AND t.version = 1
WHERE ap.organization_id = $1
  AND ap.active = true
  AND ap.source_kind <> 'computed'
  AND a.active = true
ORDER BY t.id, ap.point_key, ap.source_data_key
ON CONFLICT (template_id, point_key) DO NOTHING
`;

/**
 * Pins an unpinned roled asset to its role template. Runs BEFORE
 * `HEALTH_TEMPLATE_PIN_SQL`, which takes every `template_id IS NULL` asset that
 * is left; the same guard, for the same reason.
 */
export const HEALTH_ROLE_TEMPLATE_PIN_SQL = `
UPDATE bms.assets a
SET template_id = t.id
FROM bms.asset_templates t
WHERE a.organization_id = $1
  AND a.active = true
  AND a.template_id IS NULL
  AND t.organization_id = $1
  AND t.domain = a.domain
  AND t.code = ${ROLE_TEMPLATE_CODE_EXPR}
  AND t.version = 1
`;

/**
 * Ruling Q2: on every seed, each active asset on version 1 of its own
 * `BASELINE-<DOMAIN>` moves to its role template, when that template exists.
 * The predicate does not tell a seed-owned pin from an operator's: an asset an
 * operator instantiated from, or migrated back to, that version 1 row moves
 * too, with no audit row. An asset on a later version or another code keeps its
 * pin. A moved asset no longer matches, so a second seed re-pins nothing new
 * unless an asset has landed on version 1 since.
 */
export const HEALTH_ROLE_TEMPLATE_REPIN_SQL = `
UPDATE bms.assets a
SET template_id = role_t.id
FROM bms.asset_templates dom,
     bms.asset_templates role_t
WHERE a.organization_id = $1
  AND a.active = true
  AND dom.organization_id = $1
  AND dom.domain = a.domain
  AND dom.code = ${TEMPLATE_CODE_EXPR}
  AND dom.version = 1
  AND a.template_id = dom.id
  AND role_t.organization_id = $1
  AND role_t.domain = a.domain
  AND role_t.code = ${ROLE_TEMPLATE_CODE_EXPR}
  AND role_t.version = 1
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
 *
 * `left_on_domain_baseline` (`F2.32`) asks the re-pin's own question with the
 * re-pin's own predicates: an active asset still on version 1 of its domain
 * baseline although its role template exists. It covers the role pin as well,
 * because an asset the role pin missed falls to the domain pin and lands here.
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
  ) AS unusable,
  (
    SELECT count(*)::int
    FROM bms.assets a
    JOIN bms.asset_templates dom ON dom.id = a.template_id
    WHERE a.organization_id = $1
      AND a.active = true
      AND dom.organization_id = $1
      AND dom.domain = a.domain
      AND dom.code = ${TEMPLATE_CODE_EXPR}
      AND dom.version = 1
      AND EXISTS (
        SELECT 1 FROM bms.asset_templates role_t
        WHERE role_t.organization_id = $1
          AND role_t.domain = a.domain
          AND role_t.code = ${ROLE_TEMPLATE_CODE_EXPR}
          AND role_t.version = 1
      )
  ) AS left_on_domain_baseline
`;

/**
 * Seeds the baseline templates, pins the assets, and proves both.
 *
 * Runs inside the caller's tenant context — `seed.ts` calls it from the ESKOM
 * `withOrganization` bracket, after `seedRuledPointCatalog`, whose catalog rows
 * are what the point declaration reads.
 *
 * The order is load-bearing (`F2.32`): both template sets and their points
 * first, then the re-pin and the role pin, which read the role templates, and
 * the domain pin last, because it takes every `template_id IS NULL` asset the
 * role pin left.
 *
 * @returns how many templates (domain and role), pins (role and domain) and
 * re-pins this call wrote. Zero for all three is the correct answer on a
 * re-seed and is not a failure; the post-condition is what fails.
 */
export async function seedAssetTemplateHealth(
  pool: pg.Pool,
  organizationId: string,
): Promise<{ templates: number; pinned: number; repinned: number }> {
  const content = JSON.stringify(HEALTH_BASELINE_CONTENT);
  const domainTemplates = await pool.query(HEALTH_TEMPLATE_SQL, [organizationId, content]);
  await pool.query(HEALTH_TEMPLATE_POINTS_SQL, [organizationId]);
  const roleTemplates = await pool.query(HEALTH_ROLE_TEMPLATE_SQL, [organizationId, content]);
  await pool.query(HEALTH_ROLE_TEMPLATE_POINTS_SQL, [organizationId]);
  const repinned = await pool.query(HEALTH_ROLE_TEMPLATE_REPIN_SQL, [organizationId]);
  const rolePinned = await pool.query(HEALTH_ROLE_TEMPLATE_PIN_SQL, [organizationId]);
  const domainPinned = await pool.query(HEALTH_TEMPLATE_PIN_SQL, [organizationId]);

  const check = await pool.query<{
    unpinned: number;
    unusable: number;
    left_on_domain_baseline: number;
  }>(HEALTH_TEMPLATE_VERIFY_SQL, [organizationId]);
  const unpinned = check.rows[0]?.unpinned ?? -1;
  const unusable = check.rows[0]?.unusable ?? -1;
  const leftOnDomain = check.rows[0]?.left_on_domain_baseline ?? -1;
  if (unpinned !== 0 || unusable !== 0 || leftOnDomain !== 0) {
    throw new Error(
      `seedAssetTemplateHealth: ${unpinned} active asset(s) are pinned to no template of their ` +
        `own domain, ${unusable} baseline template(s) cannot produce a band, and ` +
        `${leftOnDomain} roled asset(s) are still on their domain baseline although their role ` +
        "template exists. A FORCE-RLS write can drop rows without raising, and a malformed " +
        "health block reads back as no band at all, so all three are checked rather than " +
        "inferred from the statements completing.",
    );
  }

  return {
    templates: (domainTemplates.rowCount ?? 0) + (roleTemplates.rowCount ?? 0),
    pinned: (rolePinned.rowCount ?? 0) + (domainPinned.rowCount ?? 0),
    repinned: repinned.rowCount ?? 0,
  };
}
