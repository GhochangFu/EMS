import { expect } from "vitest";

import {
  HEALTH_BANDS,
  HEALTH_BASELINE_CONTENT,
  HEALTH_TEMPLATE_PIN_SQL,
  HEALTH_TEMPLATE_POINTS_SQL,
  HEALTH_TEMPLATE_SQL,
  HEALTH_TEMPLATE_VERIFY_SQL,
} from "./asset-template-health-seed";

/** Vitest entry point lives in the sibling `.test.ts` (ADR 0014). */

const WRITE_STATEMENTS = [HEALTH_TEMPLATE_SQL, HEALTH_TEMPLATE_POINTS_SQL, HEALTH_TEMPLATE_PIN_SQL];

/**
 * The five names `E1.3` pins the presentation to (ADR 0050 Context).
 *
 * Listed here rather than derived from the export, so that this file is a second
 * statement of the requirement and not an echo of it. Whether the list is a
 * *valid* band list is not asserted here — `packages/db` cannot import
 * `templateHealthSchema`, and the API-side spec parses the same literal with it.
 */
export function assertTheClientsFiveBandsAreSeeded(): void {
  expect(HEALTH_BANDS.map((band) => band.label)).toEqual([
    "Excellent",
    "Good",
    "Fair",
    "Poor",
    "Critical",
  ]);
  expect(HEALTH_BASELINE_CONTENT.health?.bands).toHaveLength(5);
}

/**
 * A domain baseline weights nothing, and the seed must not start.
 *
 * An omitted weight is `1.0` (ADR 0050 Amendment 1 decision 3). A weight is also
 * a *reference* — `collectContentPointRefs` walks `health.weights`' keys and
 * `publish()` refuses one naming a point the template does not declare — so a
 * weight added here silently acquires a second thing to keep in step with the
 * catalog the points are read from.
 */
export function assertTheBaselineWeightsNothing(): void {
  expect(HEALTH_BASELINE_CONTENT.health?.weights).toBeUndefined();
  expect(HEALTH_BASELINE_CONTENT.contentVersion).toBe(1);
}

/**
 * A re-seed must not fail, and must never rewrite a published version.
 *
 * `DO NOTHING` rather than `DO UPDATE` for the second reason: ADR 0015 makes a
 * published version immutable, and an asset pins the *version*. A seed that
 * overwrote `content` would give every pinned asset different bands without
 * anything in the audit trail saying so — the one guarantee `assets.template_id`
 * exists to give, removed by a re-run of `pnpm db:seed`.
 */
export function assertReSeedingNeverRewritesAPublishedVersion(): void {
  expect(HEALTH_TEMPLATE_SQL).toContain("ON CONFLICT (organization_id, code, version) DO NOTHING");
  expect(HEALTH_TEMPLATE_POINTS_SQL).toContain("ON CONFLICT (template_id, point_key) DO NOTHING");
  for (const sql of WRITE_STATEMENTS) {
    expect(sql).not.toContain("DO UPDATE");
  }
}

/**
 * The pin owns its own existence, never its target.
 *
 * `template_id IS NULL` is what lets an operator migrate an asset to another
 * template through ADR 0039's explicit, previewed and audited path and keep that
 * pin across a re-seed. Without the guard the seed silently reverses every such
 * migration, and does it in the step furthest from where anyone would look.
 */
export function assertThePinNeverReversesAnOperatorsMigration(): void {
  expect(HEALTH_TEMPLATE_PIN_SQL).toContain("a.template_id IS NULL");
}

/**
 * An asset is never pinned to another domain's template.
 *
 * No database constraint holds this: `assets_template_id_asset_templates_id_fk`
 * checks that the template *exists*, not that it belongs to the asset's domain.
 * ADR 0031 Amendment 1 ruled the same pair in the other direction — instantiate
 * copies the template's domain onto the asset — so a cross-domain pin is a state
 * the product has already decided cannot happen, held here by the statement that
 * could create it and by the post-condition that reads it back.
 */
export function assertNoAssetIsPinnedAcrossDomains(): void {
  expect(HEALTH_TEMPLATE_PIN_SQL).toContain("t.domain = a.domain");
  expect(HEALTH_TEMPLATE_VERIFY_SQL).toContain("t.id = a.template_id AND t.domain = a.domain");
}

/**
 * Every statement is bounded to one organization.
 *
 * Not a style point, and the precedent is a measured one: `verify-hierarchy-seed`
 * asserts PHE's `asset_points` count exactly, and `F4.69`'s row records that an
 * unbounded seed statement turns that verify red one step later, where the cause
 * is furthest from the effect. The same applies here — an unbounded pin would
 * give PHE's pilot assets an ESKOM template.
 */
export function assertEveryStatementIsBoundedToOneOrganization(): void {
  expect(HEALTH_TEMPLATE_SQL).toContain("a.organization_id = $1");
  expect(HEALTH_TEMPLATE_POINTS_SQL).toContain("ap.organization_id = $1");
  expect(HEALTH_TEMPLATE_POINTS_SQL).toContain("t.organization_id = $1");
  expect(HEALTH_TEMPLATE_PIN_SQL).toContain("a.organization_id = $1");
  expect(HEALTH_TEMPLATE_PIN_SQL).toContain("t.organization_id = $1");
  expect(HEALTH_TEMPLATE_VERIFY_SQL).toContain("a.organization_id = $1");
  expect(HEALTH_TEMPLATE_VERIFY_SQL).toContain("t.organization_id = $1");
}

/**
 * The declared points claim no wiring.
 *
 * These templates carry bands for assets that already exist; they are not wiring
 * templates. A literal `source_data_key_pattern` has no `{asset_code}` token, so
 * instantiating two assets from one would map both onto one telemetry stream —
 * the aliasing `asset-templates-instantiate.service.ts` reserves `asset_code` to
 * prevent — and a `{asset_code}` pattern would claim a key `apps/sim` does not
 * write. `required = false` with a NULL pattern makes `planAsset` skip the point
 * and report it, which is the only honest third option.
 */
export function assertTheDeclaredPointsClaimNoWiring(): void {
  expect(HEALTH_TEMPLATE_POINTS_SQL).toContain("source_data_key_pattern");
  expect(HEALTH_TEMPLATE_POINTS_SQL).toContain("  NULL,\n  false,\n  0");
  expect(HEALTH_TEMPLATE_POINTS_SQL).not.toContain("{asset_code}");
}

/**
 * Points are `measured`, which is what keeps this row out of ADR 0039's merge.
 *
 * `calc-definitions.service` joins `template_points` with `WHERE kind =
 * 'derived'`, so a measured declaration gives `coalesce(asset_points.<col>,
 * template_points.<col>)` no right-hand side and changes no asset's calc
 * configuration. A `derived` point here would silently enrol 148 assets in the
 * calc engine, and would need a formula the seed has no reason to invent.
 */
export function assertTheDeclaredPointsAreMeasuredAndNotDerived(): void {
  expect(HEALTH_TEMPLATE_POINTS_SQL).toContain("'measured'");
  expect(HEALTH_TEMPLATE_POINTS_SQL).not.toContain("'derived'");
}

/**
 * The insert and its post-condition must select the same templates.
 *
 * The check finds the rows it verifies **by** `asset_type`, so an insert that
 * wrote a different one would leave the post-condition inspecting zero rows and
 * reporting a success it has not established — the failure mode the
 * post-condition exists to prevent, reintroduced one statement over. Exactly the
 * drift `ruled-point-catalog-seed` shares one predicate to avoid.
 */
export function assertTheInsertAndTheVerifySelectTheSameTemplates(): void {
  expect(HEALTH_TEMPLATE_SQL).toContain("'baseline'");
  expect(HEALTH_TEMPLATE_VERIFY_SQL).toContain("t.asset_type = 'baseline'");
}

/**
 * The post-condition reads back the two states that make `resolveBand` return
 * `null`, and the one `publish()` refuses.
 *
 * This is the gate a static test of the literal cannot give: the write is SQL,
 * so a health block the API would reject still lands, `parseHealth` returns
 * `undefined`, every band is `null`, and the donut stays exactly as empty as it
 * was — while the seed reports success.
 */
export function assertTheVerifyReadsBackWhatMakesABandNull(): void {
  expect(HEALTH_TEMPLATE_VERIFY_SQL).toContain("jsonb_array_length(t.content -> 'health' -> 'bands')");
  expect(HEALTH_TEMPLATE_VERIFY_SQL).toContain(
    "(t.content -> 'health' -> 'bands' -> -1 ->> 'minScore')::numeric IS DISTINCT FROM 0",
  );
  expect(HEALTH_TEMPLATE_VERIFY_SQL).toContain("t.status <> 'published'");
  expect(HEALTH_TEMPLATE_VERIFY_SQL).toContain("FROM bms.template_points tp");
}
