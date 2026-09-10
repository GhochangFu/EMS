import type pg from "pg";

import { pointKeysForAsset } from "../../rules/rule-points";
import {
  ALARM_PROTO,
  FIXTURE_DOMAIN,
  TEST_ASSET_PREFIX,
  assert,
  cleanup2,
  expectRejection,
  ruleFor,
  seededRules,
  twoAssets,
  type SeedFixtures,
  type Services,
} from "./asset-templates.seed-rules.integration.spec";

/**
 * `F3.49` / ADR 0058 Amendment 2 — the rule builder's picker offers exactly
 * what `assertCompatiblePoint` accepts, on a real database.
 *
 * A sibling of `asset-templates.seed-rules.integration.spec.ts` rather than
 * two more cases in it: that file sits at 989 lines against AGENTS.md §4.5's
 * 1000-line cap, and §2 says to extract before adding.
 *
 * **It shares that file's fixture helpers, not its fixture rows**, on the
 * `asset-templates.seeded-rules-guards.integration.test.ts` model. Vitest
 * evaluates each test file's module graph afresh, and `TEST_TEMPLATE_CODE` /
 * `TEST_ASSET_PREFIX` call `randomUUID()` at module scope, so this suite
 * publishes its **own** template and instantiates its **own** two assets under
 * its own per-run codes. Its wrapper owns the lifecycle and calls
 * `assertJoinPredicateIsNotVacuous` itself — that guard is not inherited, and
 * deleting it as redundant would let the union case pass on the hard-coded map
 * alone.
 *
 * What the shared helpers guarantee is the fixture's *shape*: three point keys
 * chosen outside `pointKeysForAsset`'s map, which is what makes them
 * *additions* to the picker rather than repeats, declared at `sortOrder` 0, 1
 * and 2 with the third `derived`.
 */

function sameList(actual: readonly string[], expected: readonly string[], label: string): void {
  assert(
    actual.length === expected.length && actual.every((key, i) => key === expected[i]),
    `${label}: expected [${expected.join(", ")}], got [${actual.join(", ")}]`,
  );
}

async function assetIdByCode(pool: pg.Pool, code: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(`SELECT id FROM bms.assets WHERE code = $1`, [
    code,
  ]);
  if (rows.length !== 1) {
    throw new Error(`expected exactly one bms.assets row with code ${code}, found ${rows.length}`);
  }
  return rows[0].id;
}

/**
 * The picker offers the validator's set.
 *
 * `expected` is computed here, independently of the service: the hard-coded
 * map's answer for the fixture domain and code, then the three fixture keys in
 * template order. Nine keys. The third fixture point is `derived`, so its
 * presence is what proves the picker carries no `kind` filter.
 *
 * Both branches of `getBuilderCatalog` are asserted — the filtered one the SPA
 * calls and the unfiltered `null` one — because before this row the two built
 * their lists from different code, and a fix to one is what a reviewer would
 * expect to miss the other.
 */
export async function assertPickerOffersTheValidatorsUnion(
  svc: Services,
  fx: SeedFixtures,
  pool: pg.Pool,
  templateId: string,
): Promise<void> {
  await cleanup2(pool);
  await svc.instantiate(fx.adminJwt, templateId, { rtuId: fx.rtuId, assets: twoAssets() });
  const assetCode = `${TEST_ASSET_PREFIX}01`;
  const assetId = await assetIdByCode(pool, assetCode);
  const expected = [
    ...pointKeysForAsset(FIXTURE_DOMAIN, assetCode),
    ...fx.pointKeys.map((key) => key.code),
  ];

  const filtered = await svc.rules.getBuilderCatalog([assetId]);
  assert(
    filtered.assets.length === 1,
    `getBuilderCatalog([${assetCode}]): expected 1 asset, got ${filtered.assets.length}`,
  );
  sameList(filtered.assets[0].pointKeys, expected, "filtered catalog (the SPA's branch)");

  const unfiltered = await svc.rules.getBuilderCatalog(null);
  const listed = unfiltered.assets.find((row) => row.id === assetId);
  assert(listed !== undefined, `getBuilderCatalog(null) does not list ${assetCode}`);
  sameList(listed?.pointKeys ?? [], expected, "unfiltered catalog (the assetIds == null branch)");
}

/**
 * Every key the picker offers is accepted by the validator, and one live
 * catalog key it does not offer is refused. "picker ⊆ validator" in full;
 * "validator ⊆ picker" sampled once — full equality is structural (one
 * function, `ruleTargetPointKeysByAsset`) held by
 * `tests/f3.49-picker-validator-single-source.test.ts`.
 *
 * Driven through `updateRule` on the seeded proto rule, which is the path the
 * row is about: an engineer's local override of a seeded threshold. The last
 * accepted key is read back by SQL so the loop proves nine writes rather than
 * nine absences of a rejection.
 */
export async function assertEveryOfferedKeyIsAcceptedAndOneOtherRefused(
  svc: Services,
  fx: SeedFixtures,
  pool: pg.Pool,
  templateId: string,
): Promise<void> {
  await cleanup2(pool);
  await svc.instantiate(fx.adminJwt, templateId, { rtuId: fx.rtuId, assets: twoAssets() });
  const assetCode = `${TEST_ASSET_PREFIX}01`;
  const assetId = await assetIdByCode(pool, assetCode);
  const proto = ruleFor(await seededRules(pool), assetCode, ALARM_PROTO);
  const actor = { sub: fx.adminJwt.sub, email: fx.adminJwt.email };

  const { assets: catalog } = await svc.rules.getBuilderCatalog([assetId]);
  const offered = catalog[0]?.pointKeys ?? [];
  assert(offered.length > 0, `getBuilderCatalog([${assetCode}]) offered no point keys`);

  for (const key of offered) {
    try {
      await svc.rules.updateRule(proto.id, { pointKey: key }, actor);
    } catch (err) {
      throw new Error(
        `the picker offers "${key}" for ${assetCode} and the validator refuses it: ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }
  const { rows: stored } = await pool.query<{ point_key: string | null }>(
    `SELECT point_key FROM bms.automation_rules WHERE id = $1`,
    [proto.id],
  );
  assert(
    stored[0]?.point_key === offered[offered.length - 1],
    `${proto.code}: the last accepted PATCH must have stored its point_key, got ` +
      `${String(stored[0]?.point_key)}`,
  );

  const { rows: outside } = await pool.query<{ code: string }>(
    // `F3.39`: the catalog is fleet-wide, so no organization predicate.
    // `ORDER BY created_at` (`F4.53`): the oldest row is a seeded one, which no
    // concurrent suite can delete out from under this read.
    `SELECT code FROM bms.point_keys
      WHERE active = true AND code <> ALL($1::text[])
      ORDER BY created_at, code LIMIT 1`,
    [offered],
  );
  if (outside.length === 0) {
    throw new Error(
      "F3.49 fixture: every active bms.point_keys code is offered for the fixture asset, so " +
        "there is no key to sample the refusal with. Run 'pnpm db:seed'.",
    );
  }
  await expectRejection(
    () => svc.rules.updateRule(proto.id, { pointKey: outside[0].code }, actor),
    /not compatible/,
    `a live catalog key the picker does not offer ("${outside[0].code}")`,
  );
}

/**
 * The template half comes back in **declared** order, not insertion order —
 * the `asc(sort_order)` leg of ADR 0058 Amendment 2 property 2.
 *
 * **The fixture cannot gate this as it stands, which is why this case rewrites
 * it.** `publishFixtureTemplate` declares its three points at `sortOrder` 0, 1
 * and 2 in the same order it lists them, and `publish` flips the row's status
 * rather than forking, so those rows are never re-inserted: insertion order
 * equals declared order, a sequential scan returns them sorted by accident, and
 * deleting the `ORDER BY` reddens nothing. Both reviews of `F3.49` found the
 * clause ungated. So this case moves the `derived` point to `sort_order = -1`,
 * where only `asc(sort_order)` can put it first.
 *
 * **The `asc(point_key)` tie-break is deliberately NOT gated here, and no
 * behavioural test can gate it.** Postgres does not specify the order of rows
 * that tie on every `ORDER BY` key, so the mutation's alternative is not a
 * different order — it is an *arbitrary* one, which is free to coincide with
 * the asserted one. Measured: with two fixture points tied at `sort_order = 5`
 * and the alphabetically earlier one deleted and re-inserted so that it was
 * physically last, removing `asc(point_key)` still returned the asserted order
 * and the case stayed green. That leg is held instead by the source assertion
 * in `tests/f3.49-picker-validator-single-source.test.ts`, which is the honest
 * gate for a clause whose absence has no observable consequence — the whole
 * reason the ADR argues it from the health seed's `sort_order = 0` rather than
 * from a failing test.
 *
 * It rewrites this suite's own template, so it runs last and restores the three
 * `sort_order` values afterwards.
 */
export async function assertTemplateKeysAreOrderedByDeclaredOrder(
  svc: Services,
  fx: SeedFixtures,
  pool: pg.Pool,
  templateId: string,
): Promise<void> {
  await cleanup2(pool);
  await svc.instantiate(fx.adminJwt, templateId, { rtuId: fx.rtuId, assets: twoAssets() });
  const assetCode = `${TEST_ASSET_PREFIX}01`;
  const assetId = await assetIdByCode(pool, assetCode);

  // The template the picker's join actually reads, taken from the asset rather
  // than from `templateId`, so a future change to what instantiate pins cannot
  // make this case rewrite a template nobody reads.
  const { rows: pinned } = await pool.query<{ template_id: string }>(
    `SELECT template_id FROM bms.assets WHERE id = $1`,
    [assetId],
  );
  const versionId = pinned[0]?.template_id;
  assert(Boolean(versionId), `${assetCode} is pinned to no template, so there is nothing to order`);

  const [first, second, derived] = fx.pointKeys.map((key) => key.code);
  const rewritten = [derived, first, second];

  // Anti-vacuity: if the rewritten order matched insertion order, a sequential
  // scan would satisfy the assertion and this case would hold nothing.
  assert(
    rewritten.join() !== fx.pointKeys.map((key) => key.code).join(),
    `F3.49 fixture: the rewritten order [${rewritten.join(", ")}] equals insertion order, so ` +
      "the sort_order leg cannot discriminate. Choose different fixture point keys.",
  );

  try {
    // -1, 0, 1: the `derived` point declared first, the other two keeping their
    // relative order, so nothing ties and the assertion turns on `sort_order`
    // alone.
    await pool.query(
      `UPDATE bms.template_points
          SET sort_order = CASE point_key WHEN $2 THEN -1 WHEN $3 THEN 0 ELSE 1 END
        WHERE template_id = $1`,
      [versionId, derived, first],
    );

    const { assets: catalog } = await svc.rules.getBuilderCatalog([assetId]);
    sameList(
      catalog[0]?.pointKeys ?? [],
      [...pointKeysForAsset(FIXTURE_DOMAIN, assetCode), ...rewritten],
      "template keys ordered by declared sort_order, not by insertion",
    );
  } finally {
    await pool.query(
      `UPDATE bms.template_points
          SET sort_order = CASE point_key WHEN $2 THEN 0 WHEN $3 THEN 1 ELSE 2 END
        WHERE template_id = $1`,
      [versionId, first, second],
    );
  }
}
