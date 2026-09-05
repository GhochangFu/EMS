import { CALC_DIALECT_V2 } from "@bms/shared";
import type { AdminAssetTemplateDto } from "@bms/shared";

import type { AssetTemplatesAdminService } from "./asset-templates.service";
import { TEST_CODE, type Fixtures } from "./asset-templates.lifecycle.integration.spec";

/**
 * `F2.9` / ADR 0055 — the two write-path rules for `bms-calc-v2` that only a
 * database can prove.
 *
 * A third suite in the `F2.1`/`F2.6` shape rather than two more cases in
 * `asset-templates.lifecycle.integration.spec.ts`: that file is at 993 of the
 * §4.5 whole-file cap and cannot take them. It reuses that file's fixtures,
 * `TEST_CODE` and `cleanup` — the same way `asset-templates.migrate.integration`
 * reuses the instantiate suite's — so both codes below (`-XREF`, `-RATIO`) are
 * swept by the `${TEST_CODE}%` prefix delete already documented there, and no
 * cleanup change is owed.
 *
 * Neither case can be a schema test. The first is a *catalog* read; the second
 * is a column surviving a delete-then-insert two versions apart. Both are
 * silences when they fail — nothing throws, a value is simply not there.
 */

/** The derived point of a template, or a failure that says which stage lost it. */
function derivedPointOf(template: AdminAssetTemplateDto, stage: string): AdminAssetTemplateDto["points"][number] {
  const point = template.points.find((candidate) => candidate.kind === "derived");
  if (!point) {
    throw new Error(`${stage}: the derived point is missing from the template altogether`);
  }
  return point;
}

/**
 * ADR 0055: a `bms-calc-v2` aggregate names its point key **inside** the
 * formula.
 *
 * `template_points_point_key_fkey` (migration `0058`) holds the keys a template
 * *declares*; an aggregate's key is declared nowhere. Neither the constraint
 * nor the pre-`F2.9` catalog read could see it, so a template naming a
 * non-existent key would save, publish, and then fail once per tick as a
 * counted skip nobody is watching. `crossRefPointKeys` is what makes it a 400
 * at the moment the author is still looking at the formula.
 */
export async function assertCrossRefPointKeysAreCatalogued(
  svc: AssetTemplatesAdminService,
  fx: Fixtures,
): Promise<void> {
  let message: string | null = null;
  try {
    await svc.create(fx.adminJwt, {
      organizationId: fx.organizationId,
      code: `${TEST_CODE}-XREF`,
      name: "Cross-ref key",
      assetType: "test_rig",
      domain: "water",
      points: [
        { pointKey: fx.pointKeys[1], kind: "measured", required: true, sortOrder: 0 },
        {
          pointKey: fx.pointKeys[0],
          kind: "derived",
          formula: "sum({definitely_not_a_real_point_key} @site)",
          formulaDialect: CALC_DIALECT_V2,
          calcTrigger: "scheduled",
          calcIntervalSeconds: 60,
          required: false,
          sortOrder: 1,
        },
      ],
    });
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  if (message === null) {
    throw new Error(
      "a bms-calc-v2 aggregate over an uncatalogued point key was accepted — the formula " +
        "is a varchar, so nothing downstream will ever refuse it either",
    );
  }
  if (!/definitely_not_a_real_point_key/.test(message)) {
    throw new Error(
      `the refusal must name the offending key, exactly as the declared-key refusal does; ` +
        `got "${message}"`,
    );
  }
}

/**
 * `F2.9` finding 15 — ADR 0055 decision 11's ratio must survive a version bump.
 *
 * `createDraftFrom` copies the parent version's points through the *same*
 * `replacePoints` mapper the create path uses, taking raw `PointRow`s rather
 * than a parsed body. A field that mapper does not name is dropped with no
 * compile error, no exception and no other failing test — and `min_coverage_ratio`
 * was exactly that until this task, because `mapPoint` reads the column, so the
 * value round-trips on a *read* and only a write loses it.
 *
 * What that costs is the reason this test exists rather than a code comment:
 * decision 11 defines `NULL` as **fail closed**, so a published `v2` formula
 * whose ratio was silently reset would stop computing after the next version
 * bump, with no error to read and no edit to blame.
 */
export async function assertVersionBumpCopiesMinCoverageRatio(
  svc: AssetTemplatesAdminService,
  fx: Fixtures,
): Promise<void> {
  const created = await svc.create(fx.adminJwt, {
    organizationId: fx.organizationId,
    code: `${TEST_CODE}-RATIO`,
    name: "Coverage ratio",
    assetType: "test_rig",
    domain: "water",
    points: [
      { pointKey: fx.pointKeys[1], kind: "measured", required: true, sortOrder: 0 },
      {
        pointKey: fx.pointKeys[0],
        kind: "derived",
        // A *local* reference on purpose: this case is about one column
        // surviving a copy, and an aggregate would also drag in the catalog
        // check above, so a failure could mean either thing.
        formula: `{${fx.pointKeys[1]}} * 2`,
        formulaDialect: CALC_DIALECT_V2,
        calcTrigger: "scheduled",
        calcIntervalSeconds: 60,
        minCoverageRatio: 0.5,
        required: false,
        sortOrder: 1,
      },
    ],
  });
  const onCreate = derivedPointOf(created, "create").minCoverageRatio;
  if (onCreate !== 0.5) {
    throw new Error(
      `replacePoints dropped minCoverageRatio on the create path: stored 0.5, read back ` +
        `${onCreate}. Decision 11 reads null as fail closed, so this formula would never compute.`,
    );
  }

  const published = await svc.publish(fx.adminJwt, created.id);
  const bumped = await svc.createDraftFrom(fx.adminJwt, published.id);
  const afterBump = derivedPointOf(bumped, "version bump").minCoverageRatio;
  if (afterBump !== 0.5) {
    throw new Error(
      `a version bump must carry minCoverageRatio forward: v${published.version} held 0.5, ` +
        `v${bumped.version} read back ${afterBump}. createDraftFrom copies PointRows through ` +
        "replacePoints, so a field that mapper does not name is reset to NULL — which " +
        "decision 11 reads as fail closed, silently stopping a published formula.",
    );
  }
  if (derivedPointOf(bumped, "version bump").formulaDialect !== CALC_DIALECT_V2) {
    throw new Error("the version bump must carry the v2 dialect forward beside the ratio");
  }
}
