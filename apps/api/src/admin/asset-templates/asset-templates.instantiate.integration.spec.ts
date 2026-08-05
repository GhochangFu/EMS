import type pg from "pg";

import type {
  AdminAssetTemplateDto,
  AssetInstantiationResultDto,
  JwtPayload,
} from "@bms/shared";

import type { AssetTemplatesAdminService } from "./asset-templates.service";

/**
 * `F2.2` — template instantiation against a real database (ADR 0015 §6/§7 as
 * amended 2026-08-05).
 *
 * The Zod contract is proven by `asset-templates.schema.spec.ts`. Everything
 * here is a *database* outcome that no pure function can express: which rows
 * exist afterwards, what `source_kind` they carry, and — the ones that matter
 * most — which rows do **not** exist after a failure. Partial instantiation is
 * the worst outcome this feature can produce, so half these assertions count
 * rows after a deliberate abort.
 *
 * Every expectation is computed with **independent SQL through the pool**,
 * never read back from the service's own return value. A service that returns
 * `pointCount: 8` while writing six rows must fail here; asserting against its
 * own DTO would let it grade its own work.
 *
 * These tests write. Everything they create carries `TEST_TEMPLATE_CODE` or the
 * `TEST_ASSET_PREFIX`, and is deleted before and after the run — cleaning up
 * first means a crashed run does not poison the next one on a shared local
 * database.
 */

export const TEST_TEMPLATE_CODE = "F22-INSTANTIATE-TEST";
export const TEST_ASSET_PREFIX = "F22-INST-TEST-";

/**
 * The two services this suite drives, plus an `instantiate` that takes the
 * **wire-shape** payload.
 *
 * `instantiateAssetsBodySchema` transforms `{ rtuId | locationId }` into a
 * discriminated `{ target }` before the service sees it, so calling the service
 * directly would mean hand-building the post-transform shape — and would test a
 * payload no HTTP client ever sends. The wrapper supplied by the `.test` file
 * parses through the real schema instead, so these cases exercise the same path
 * the controller does, transform included.
 */
export type Services = {
  templates: AssetTemplatesAdminService;
  instantiate: (
    jwt: JwtPayload,
    templateId: string,
    body: unknown,
  ) => Promise<AssetInstantiationResultDto>;
};

/** ADR 0018's honest source kinds for the two target paths. */
const MEASURED = "measured";
const UNMAPPED = "unmapped";

export type Fixtures = {
  organizationId: string;
  /** Four active point-key codes in that org, with their catalog units. */
  pointKeys: { code: string; unit: string | null }[];
  /** An active RTU whose active location the location admin also administers. */
  rtuId: string;
  rtuLocationId: string;
  /** A second active location in the same org, used for the gateway-less path. */
  otherLocationId: string;
  /** An active location in a *different* org — the cross-org rejection target. */
  foreignLocationId: string;
  /** The inactive location F4.10 seeds (`ESK-DECOMM-01`). */
  inactiveLocationId: string;
  adminJwt: JwtPayload;
  locationAdminJwt: JwtPayload;
};

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function expectRejection(
  run: () => Promise<unknown>,
  match: RegExp,
  what: string,
): Promise<void> {
  let message: string | null = null;
  try {
    await run();
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  assert(message !== null, `${what}: expected a rejection, but the call succeeded`);
  assert(
    match.test(message ?? ""),
    `${what}: rejected with "${message}", which does not match ${match}`,
  );
}

/** Counts this suite's assets by independent SQL. */
async function countTestAssets(pool: pg.Pool): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms.assets WHERE code LIKE $1`,
    [`${TEST_ASSET_PREFIX}%`],
  );
  return Number(rows[0].n);
}

/** Deletes only this suite's rows, children first. */
export async function cleanup(pool: pg.Pool): Promise<void> {
  await pool.query(
    `DELETE FROM bms.asset_points
      WHERE asset_id IN (SELECT id FROM bms.assets WHERE code LIKE $1)`,
    [`${TEST_ASSET_PREFIX}%`],
  );
  await pool.query(`DELETE FROM bms.assets WHERE code LIKE $1`, [`${TEST_ASSET_PREFIX}%`]);
  // template_points cascade on the FK. LIKE, so the edge-case template below is
  // removed alongside the main fixture.
  await pool.query(`DELETE FROM bms.asset_templates WHERE code LIKE $1`, [`${TEST_TEMPLATE_CODE}%`]);
}

/**
 * Resolves fixtures from seeded data.
 *
 * The RTU is deliberately one inside the location admin's own grant, so the
 * same target proves both the global-admin path and Amendment 1B's
 * deploy-but-cannot-author split without needing two templates.
 */
export async function loadFixtures(pool: pg.Pool): Promise<Fixtures> {
  const { rows: grants } = await pool.query<{ organization_id: string; location_id: string }>(
    `SELECT l.organization_id, l.id AS location_id
       FROM bms.users u
       JOIN bms.user_location_access ula ON ula.user_id = u.id
       JOIN bms.locations l ON l.id = ula.location_id
      WHERE u.email = 'wc-admin@bms.local' AND l.active = true
      LIMIT 1`,
  );
  const grant = grants[0];
  if (!grant) {
    throw new Error(
      "F2.2 fixtures missing — wc-admin@bms.local has no active location grant. " +
        "Run 'pnpm db:seed'; without it the location-admin deploy split cannot be tested, " +
        "and a suite that silently skipped it would assert the opposite of ADR 0015 §7.",
    );
  }

  const { rows: rtuRows } = await pool.query<{ id: string }>(
    `SELECT id FROM bms.rtus WHERE location_id = $1 AND active = true ORDER BY code LIMIT 1`,
    [grant.location_id],
  );
  if (!rtuRows[0]) {
    throw new Error("F2.2 fixtures missing — no active RTU in the location admin's location");
  }

  const { rows: keyRows } = await pool.query<{ code: string; unit: string | null }>(
    `SELECT code, unit FROM bms.point_keys
      WHERE organization_id = $1 AND active = true ORDER BY code LIMIT 4`,
    [grant.organization_id],
  );
  if (keyRows.length < 4) {
    throw new Error(
      `F2.2 fixtures missing — the organization has ${keyRows.length} active point keys, ` +
        "needs 4. Without them the derived-exclusion and unit-fallback cases collapse.",
    );
  }

  const { rows: otherRows } = await pool.query<{ id: string }>(
    `SELECT id FROM bms.locations
      WHERE organization_id = $1 AND active = true AND id <> $2 ORDER BY code LIMIT 1`,
    [grant.organization_id, grant.location_id],
  );
  const { rows: foreignRows } = await pool.query<{ id: string }>(
    `SELECT id FROM bms.locations
      WHERE organization_id <> $1 AND active = true ORDER BY code LIMIT 1`,
    [grant.organization_id],
  );
  const { rows: inactiveRows } = await pool.query<{ id: string }>(
    `SELECT id FROM bms.locations WHERE active = false ORDER BY code LIMIT 1`,
  );
  if (!otherRows[0] || !foreignRows[0] || !inactiveRows[0]) {
    throw new Error(
      "F2.2 fixtures missing — need a second active location in the org, an active location " +
        "in another org, and one inactive location (F4.10 seeds ESK-DECOMM-01). Run 'pnpm db:seed'.",
    );
  }

  return {
    organizationId: grant.organization_id,
    pointKeys: keyRows,
    rtuId: rtuRows[0].id,
    rtuLocationId: grant.location_id,
    otherLocationId: otherRows[0].id,
    foreignLocationId: foreignRows[0].id,
    inactiveLocationId: inactiveRows[0].id,
    adminJwt: {
      sub: "00000000-0000-4000-8000-000000000000",
      email: "admin@bms.local",
      name: "integration:admin",
      role: "admin",
    },
    locationAdminJwt: {
      sub: "00000000-0000-4000-8000-000000000000",
      email: "wc-admin@bms.local",
      name: "integration:location-admin",
      role: "location_admin",
    },
  };
}

/**
 * Publishes the template every case below instantiates.
 *
 * Four points, each carrying one rule:
 * - `[0]` measured, required, `{asset_code}` pattern, **no unit override** — proves the catalog fallback.
 * - `[1]` measured, required, `{unit}` pattern, unit override — proves substitution and the override.
 * - `[2]` **derived**, required — must never produce an `asset_points` row.
 * - `[3]` measured, **optional**, no pattern — must be skipped and reported.
 */
export async function publishFixtureTemplate(
  svc: Services,
  fx: Fixtures,
): Promise<AdminAssetTemplateDto> {
  const draft = await svc.templates.create(fx.adminJwt, {
    organizationId: fx.organizationId,
    code: TEST_TEMPLATE_CODE,
    name: "Instantiation Fixture",
    assetType: "test_skid",
    domain: "water",
    points: [
      {
        pointKey: fx.pointKeys[0].code,
        kind: "measured",
        required: true,
        sortOrder: 0,
        sourceDataKeyPattern: "{asset_code}_FEED_P",
      },
      {
        pointKey: fx.pointKeys[1].code,
        kind: "measured",
        required: true,
        sortOrder: 1,
        unit: "degC",
        sourceDataKeyPattern: "CH{unit}_SUPPLY_T",
      },
      {
        pointKey: fx.pointKeys[2].code,
        kind: "derived",
        required: true,
        sortOrder: 2,
        sourceDataKeyPattern: "{asset_code}_EFFICIENCY",
      },
      {
        pointKey: fx.pointKeys[3].code,
        kind: "measured",
        required: false,
        sortOrder: 3,
      },
    ],
  });
  return svc.templates.publish(fx.adminJwt, draft.id);
}

/**
 * The wired path: an RTU target produces `measured` points carrying the RTU.
 *
 * Also the derived-exclusion proof. ADR 0015 §6 step 5 instantiates measured
 * points only — a derived tag is computed by the calc engine (`F2.6`) and has
 * no honest `source_data_key`, so a row for it would be a fabricated mapping
 * that `apps/ingest` would later read as real wiring.
 */
export async function assertRtuPathProducesMeasuredPoints(
  svc: Services,
  fx: Fixtures,
  pool: pg.Pool,
  templateId: string,
): Promise<void> {
  const result = await svc.instantiate(fx.adminJwt, templateId, {
    rtuId: fx.rtuId,
    assets: [
      { code: `${TEST_ASSET_PREFIX}01`, name: "Skid 01", sourceDataKeyVars: { unit: "01" } },
      { code: `${TEST_ASSET_PREFIX}02`, name: "Skid 02", sourceDataKeyVars: { unit: "02" } },
    ],
  });
  assert(result.assetCount === 2, `expected 2 assets, service reported ${result.assetCount}`);

  const { rows: assetRows } = await pool.query<{
    code: string;
    location_id: string;
    rtu_id: string | null;
    template_id: string | null;
    domain: string;
    site_name: string;
  }>(
    `SELECT code, location_id, rtu_id, template_id, domain, site_name
       FROM bms.assets WHERE code LIKE $1 ORDER BY code`,
    [`${TEST_ASSET_PREFIX}%`],
  );
  assert(assetRows.length === 2, `expected 2 asset rows in the database, found ${assetRows.length}`);

  for (const row of assetRows) {
    assert(
      row.location_id === fx.rtuLocationId,
      `${row.code}: location must come from the RTU, got ${row.location_id}`,
    );
    assert(row.rtu_id === fx.rtuId, `${row.code}: must carry the target RTU`);
    assert(
      row.template_id === templateId,
      `${row.code}: template_id must pin the exact version instantiated`,
    );
    assert(row.domain === "water", `${row.code}: domain must come from the template`);
    assert(
      row.site_name.length > 0,
      `${row.code}: site_name is NOT NULL and must fall back to the location name`,
    );
  }

  // Two measured points per asset — not three, and not four.
  const { rows: pointRows } = await pool.query<{
    code: string;
    point_key: string;
    source_data_key: string;
    unit: string | null;
    rtu_id: string | null;
    source_kind: string;
  }>(
    `SELECT a.code, p.point_key, p.source_data_key, p.unit, p.rtu_id, p.source_kind
       FROM bms.asset_points p JOIN bms.assets a ON a.id = p.asset_id
      WHERE a.code LIKE $1 ORDER BY a.code, p.point_key`,
    [`${TEST_ASSET_PREFIX}%`],
  );
  assert(
    pointRows.length === 4,
    `expected 4 point rows (2 assets x 2 measured), found ${pointRows.length}`,
  );
  assert(
    !pointRows.some((row) => row.point_key === fx.pointKeys[2].code),
    `the derived point ${fx.pointKeys[2].code} must never be instantiated (ADR 0015 §6 step 5)`,
  );
  assert(
    !pointRows.some((row) => row.point_key === fx.pointKeys[3].code),
    "the optional point with no pattern must be skipped, not given a placeholder key",
  );

  for (const row of pointRows) {
    assert(
      row.source_kind === MEASURED,
      `${row.code}/${row.point_key}: RTU-targeted points must be "${MEASURED}", got "${row.source_kind}"`,
    );
    assert(
      row.rtu_id === fx.rtuId,
      `${row.code}/${row.point_key}: asset_points_source_ref_check requires the RTU on a measured point`,
    );
  }

  // Substitution: {asset_code} from the asset, {unit} from the caller's vars.
  const first = pointRows.filter((row) => row.code === `${TEST_ASSET_PREFIX}01`);
  const byKey = new Map(first.map((row) => [row.point_key, row]));
  assert(
    byKey.get(fx.pointKeys[0].code)?.source_data_key === `${TEST_ASSET_PREFIX}01_FEED_P`,
    `{asset_code} must substitute the asset's own code, got ` +
      `"${byKey.get(fx.pointKeys[0].code)?.source_data_key}"`,
  );
  assert(
    byKey.get(fx.pointKeys[1].code)?.source_data_key === "CH01_SUPPLY_T",
    `caller vars must substitute, got "${byKey.get(fx.pointKeys[1].code)?.source_data_key}"`,
  );

  // Unit: the template's value is an override; null means "use the catalog's".
  assert(
    byKey.get(fx.pointKeys[1].code)?.unit === "degC",
    "a template unit override must win over the catalog unit",
  );
  assert(
    (byKey.get(fx.pointKeys[0].code)?.unit ?? null) === fx.pointKeys[0].unit,
    `a point with no unit override must inherit the catalog unit ` +
      `(${fx.pointKeys[0].unit}), got ${byKey.get(fx.pointKeys[0].code)?.unit}`,
  );

  await cleanupAssets(pool);
}

/**
 * The gateway-less path (ADR 0015 Amendment 1A).
 *
 * ADR 0018 made `assets.rtu_id` nullable precisely so an asset can exist
 * without wiring. `unmapped` rather than `manual` is the honest record: nobody
 * has claimed these points are hand-entered, only that no source is known yet.
 * `manual` is a positive assertion an operator makes later.
 */
export async function assertLocationPathProducesUnmappedPoints(
  svc: Services,
  fx: Fixtures,
  pool: pg.Pool,
  templateId: string,
): Promise<void> {
  const result = await svc.instantiate(fx.adminJwt, templateId, {
    locationId: fx.otherLocationId,
    assets: [
      {
        code: `${TEST_ASSET_PREFIX}10`,
        name: "Unwired Skid",
        siteName: "Explicit Site",
        sourceDataKeyVars: { unit: "10" },
      },
    ],
  });
  assert(result.sourceKind === UNMAPPED, `expected "${UNMAPPED}", got "${result.sourceKind}"`);
  assert(result.rtuId === null, "a location-targeted batch must report no RTU");

  const { rows } = await pool.query<{
    location_id: string;
    rtu_id: string | null;
    site_name: string;
  }>(`SELECT location_id, rtu_id, site_name FROM bms.assets WHERE code = $1`, [
    `${TEST_ASSET_PREFIX}10`,
  ]);
  assert(rows.length === 1, "expected exactly one asset");
  assert(rows[0].location_id === fx.otherLocationId, "the asset must land in the target location");
  assert(rows[0].rtu_id === null, "a location-targeted asset must have no gateway");
  assert(
    rows[0].site_name === "Explicit Site",
    `an explicit siteName must win over the location-name fallback, got "${rows[0].site_name}"`,
  );

  const { rows: pointRows } = await pool.query<{ rtu_id: string | null; source_kind: string }>(
    `SELECT p.rtu_id, p.source_kind FROM bms.asset_points p
       JOIN bms.assets a ON a.id = p.asset_id WHERE a.code = $1`,
    [`${TEST_ASSET_PREFIX}10`],
  );
  assert(pointRows.length === 2, `expected 2 measured points, found ${pointRows.length}`);
  for (const row of pointRows) {
    assert(
      row.source_kind === UNMAPPED,
      `location-targeted points must be "${UNMAPPED}", got "${row.source_kind}"`,
    );
    assert(
      row.rtu_id === null,
      "asset_points_source_ref_check requires rtu_id to be null when source_kind is not measured",
    );
  }

  await cleanupAssets(pool);
}

/**
 * An optional measured point with no resolvable key is skipped **and named**.
 *
 * Reporting it is the point: "4 points in, 2 rows out" is otherwise
 * indistinguishable from a bug, and a commissioning engineer needs to know
 * which tag is unmapped before the plant goes live.
 */
export async function assertOptionalPointIsSkippedAndReported(
  svc: Services,
  fx: Fixtures,
  pool: pg.Pool,
  templateId: string,
): Promise<void> {
  const result = await svc.instantiate(fx.adminJwt, templateId, {
    rtuId: fx.rtuId,
    assets: [
      { code: `${TEST_ASSET_PREFIX}20`, name: "Skid 20", sourceDataKeyVars: { unit: "20" } },
    ],
  });

  const asset = result.assets[0];
  assert(
    asset.skippedPoints.includes(fx.pointKeys[3].code),
    `the optional patternless point must be reported as skipped, got ` +
      `[${asset.skippedPoints.join(", ")}]`,
  );
  assert(
    !asset.skippedPoints.includes(fx.pointKeys[2].code),
    "the derived point is excluded by kind, not skipped for want of a pattern — " +
      "reporting it as skipped would suggest it could have been mapped",
  );

  const { rows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms.asset_points p
       JOIN bms.assets a ON a.id = p.asset_id WHERE a.code = $1`,
    [`${TEST_ASSET_PREFIX}20`],
  );
  assert(
    Number(rows[0].n) === asset.pointCount,
    `the reported pointCount (${asset.pointCount}) must equal the rows actually written (${rows[0].n})`,
  );

  await cleanupAssets(pool);
}

/**
 * A required point with an unsubstituted token aborts the **whole** batch.
 *
 * The rollback assertion is the one that matters. `source_data_key` is
 * `NOT NULL`, so the alternatives to aborting are a placeholder — which
 * `apps/ingest` would read as real wiring — or thirty-nine assets where the
 * fortieth is silently missing. Both are worse than failing.
 */
export async function assertRequiredPointAbortsWholeBatch(
  svc: Services,
  fx: Fixtures,
  pool: pg.Pool,
  templateId: string,
): Promise<void> {
  const before = await countTestAssets(pool);
  assert(before === 0, `precondition: expected a clean slate, found ${before} assets`);

  await expectRejection(
    () =>
      svc.instantiate(fx.adminJwt, templateId, {
        rtuId: fx.rtuId,
        assets: [
          { code: `${TEST_ASSET_PREFIX}30`, name: "Fine", sourceDataKeyVars: { unit: "30" } },
          // No `unit` var, so the required `CH{unit}_SUPPLY_T` cannot resolve.
          { code: `${TEST_ASSET_PREFIX}31`, name: "Broken" },
        ],
      }),
    new RegExp(`${TEST_ASSET_PREFIX}31[\\s\\S]*${fx.pointKeys[1].code}`),
    "an unresolvable required point must be rejected naming both the asset and the point",
  );

  const after = await countTestAssets(pool);
  assert(
    after === 0,
    `a failed batch must write nothing, but ${after} assets survived — this is the ` +
      "partial-instantiation failure ADR 0015 §6 exists to prevent",
  );
}

/**
 * A colliding asset code fails the batch and leaves nothing behind.
 *
 * `bms.assets.code` is *globally* unique, not per-location (ADR 0015 §6), which
 * is a genuine trap for a caller generating codes per site.
 */
export async function assertCollidingCodeRollsBackBatch(
  svc: Services,
  fx: Fixtures,
  pool: pg.Pool,
  templateId: string,
): Promise<void> {
  await svc.instantiate(fx.adminJwt, templateId, {
    rtuId: fx.rtuId,
    assets: [
      { code: `${TEST_ASSET_PREFIX}40`, name: "Existing", sourceDataKeyVars: { unit: "40" } },
    ],
  });
  assert((await countTestAssets(pool)) === 1, "precondition: one asset should exist");

  await expectRejection(
    () =>
      svc.instantiate(fx.adminJwt, templateId, {
        rtuId: fx.rtuId,
        assets: [
          { code: `${TEST_ASSET_PREFIX}41`, name: "New", sourceDataKeyVars: { unit: "41" } },
          { code: `${TEST_ASSET_PREFIX}40`, name: "Collides", sourceDataKeyVars: { unit: "40" } },
        ],
      }),
    new RegExp(`${TEST_ASSET_PREFIX}40`),
    "a colliding code must be rejected by name, not by constraint",
  );

  const after = await countTestAssets(pool);
  assert(
    after === 1,
    `only the pre-existing asset should remain, found ${after} — the batch's other ` +
      "asset must not survive a rejected call",
  );

  await cleanupAssets(pool);
}

/** Only published versions instantiate; a draft's shape is not yet frozen. */
export async function assertOnlyPublishedTemplatesInstantiate(
  svc: Services,
  fx: Fixtures,
  publishedId: string,
): Promise<void> {
  const draft = await svc.templates.createDraftFrom(fx.adminJwt, publishedId);
  await expectRejection(
    () =>
      svc.instantiate(fx.adminJwt, draft.id, {
        rtuId: fx.rtuId,
        assets: [{ code: `${TEST_ASSET_PREFIX}50`, name: "From a draft" }],
      }),
    /published/i,
    "instantiating a draft must be rejected",
  );
  await svc.templates.deleteDraft(fx.adminJwt, draft.id);
}

/** A template may not cross organization boundaries (ADR 0015 §6 step 1). */
export async function assertCrossOrgTargetRejected(
  svc: Services,
  fx: Fixtures,
  templateId: string,
): Promise<void> {
  await expectRejection(
    () =>
      svc.instantiate(fx.adminJwt, templateId, {
        locationId: fx.foreignLocationId,
        assets: [{ code: `${TEST_ASSET_PREFIX}60`, name: "Wrong org" }],
      }),
    /different organization/i,
    "a target in another organization must be rejected",
  );
}

/** Inactive targets are closed to new work (ADR 0009). */
export async function assertInactiveTargetRejected(
  svc: Services,
  fx: Fixtures,
  templateId: string,
): Promise<void> {
  await expectRejection(
    () =>
      svc.instantiate(fx.adminJwt, templateId, {
        locationId: fx.inactiveLocationId,
        assets: [{ code: `${TEST_ASSET_PREFIX}70`, name: "Into a decommissioned site" }],
      }),
    /inactive|different organization/i,
    "an inactive location must not accept new assets",
  );
}

/**
 * **Amendment 1B's central claim**, and the reason this suite exists.
 *
 * ADR 0015 §7 originally required `canManageTemplate` *and* `canManageLocation`
 * to instantiate. `canManageTemplate` is false for `location_admin` by design,
 * so that conjunction denied the one role the section exists to allow —
 * model-once-deploy-many was unreachable for a multi-site client. The corrected
 * predicate is template *readability* plus `canManageLocation`.
 *
 * Both halves are asserted here. A regression that restored the old predicate
 * would turn the first half red; one that dropped the location check entirely
 * would turn the second red.
 */
export async function assertLocationAdminDeploysButCannotAuthor(
  svc: Services,
  fx: Fixtures,
  pool: pg.Pool,
  templateId: string,
): Promise<void> {
  // Deploy into their own location: permitted.
  await svc.instantiate(fx.locationAdminJwt, templateId, {
    rtuId: fx.rtuId,
    assets: [
      { code: `${TEST_ASSET_PREFIX}80`, name: "Deployed by a location admin", sourceDataKeyVars: { unit: "80" } },
    ],
  });
  const { rows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms.assets WHERE code = $1`,
    [`${TEST_ASSET_PREFIX}80`],
  );
  assert(
    Number(rows[0].n) === 1,
    "a location admin must be able to deploy a published org template into their own location",
  );

  // Deploy into a location they do not administer: denied.
  await expectRejection(
    () =>
      svc.instantiate(fx.locationAdminJwt, templateId, {
        locationId: fx.otherLocationId,
        assets: [{ code: `${TEST_ASSET_PREFIX}81`, name: "Out of scope" }],
      }),
    /outside your access scope/i,
    "a location admin must not deploy into a location outside their grant",
  );

  // Authoring stays closed — the asymmetry Amendment 1B preserves.
  await expectRejection(
    () =>
      svc.templates.create(fx.locationAdminJwt, {
        organizationId: fx.organizationId,
        code: `${TEST_TEMPLATE_CODE}-BY-LOCADMIN`,
        name: "Should not exist",
        assetType: "test_skid",
        domain: "water",
        points: [],
      }),
    /location admin/i,
    "a location admin must still be unable to author a template",
  );

  await cleanupAssets(pool);
}

/**
 * A colliding code **outside** the caller's scope is counted, never named.
 *
 * `bms.assets.code` is globally unique, so an unscoped pre-check that echoes
 * every hit is a cross-tenant existence oracle: 200 guessable codes per call
 * reveals which exist anywhere in the deployment, and because the check runs
 * before the transaction it writes nothing and raises no audit row — the probe
 * is free and untraceable. Codes the caller can already see stay named, because
 * that is the part ADR 0015 §6 asked for.
 */
export async function assertCollisionDisclosureIsScoped(
  svc: Services,
  fx: Fixtures,
  pool: pg.Pool,
  templateId: string,
): Promise<void> {
  // Seed a collision the location admin cannot see: same org, a location
  // outside their grant.
  const hidden = `${TEST_ASSET_PREFIX}90`;
  await svc.instantiate(fx.adminJwt, templateId, {
    locationId: fx.otherLocationId,
    assets: [{ code: hidden, name: "Out of the location admin's sight", sourceDataKeyVars: { unit: "90" } }],
  });

  let message = "";
  try {
    await svc.instantiate(fx.locationAdminJwt, templateId, {
      rtuId: fx.rtuId,
      assets: [{ code: hidden, name: "Probe", sourceDataKeyVars: { unit: "90" } }],
    });
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }

  assert(message !== "", "colliding on an out-of-scope code must still be rejected");
  assert(
    !message.includes(hidden),
    `the rejection must not name an asset code outside the caller's scope, but said: "${message}"`,
  );
  assert(
    /outside your access scope/i.test(message),
    `the rejection must say a collision exists without naming it, but said: "${message}"`,
  );

  // The global admin, who can see everything, still gets the code by name.
  let adminMessage = "";
  try {
    await svc.instantiate(fx.adminJwt, templateId, {
      rtuId: fx.rtuId,
      assets: [{ code: hidden, name: "Probe", sourceDataKeyVars: { unit: "90" } }],
    });
  } catch (err) {
    adminMessage = err instanceof Error ? err.message : String(err);
  }
  assert(
    adminMessage.includes(hidden),
    "a caller who can see the colliding asset must still be told which code collided — " +
      `scoping the disclosure must not blind the admin, but said: "${adminMessage}"`,
  );

  await cleanupAssets(pool);
}

/**
 * A `{token}` naming an inherited `Object.prototype` member is unresolved.
 *
 * With a plain object literal, `vars["constructor"]` returns a function rather
 * than `undefined`, so the unresolved branch never fires and `replace` coerces
 * it — writing `CHfunction Object() { [native code] }_T` into `source_data_key`,
 * under the length guard and straight into what `apps/ingest` reads as wiring.
 */
export async function assertPrototypeTokensDoNotResolve(
  svc: Services,
  fx: Fixtures,
  pool: pg.Pool,
): Promise<void> {
  const draft = await svc.templates.create(fx.adminJwt, {
    organizationId: fx.organizationId,
    code: `${TEST_TEMPLATE_CODE}-EDGE`,
    name: "Prototype token fixture",
    assetType: "test_skid",
    domain: "water",
    points: [
      {
        pointKey: fx.pointKeys[0].code,
        kind: "measured",
        required: true,
        sortOrder: 0,
        sourceDataKeyPattern: "CH{constructor}_T",
      },
    ],
  });
  const published = await svc.templates.publish(fx.adminJwt, draft.id);

  await expectRejection(
    () =>
      svc.instantiate(fx.adminJwt, published.id, {
        rtuId: fx.rtuId,
        assets: [{ code: `${TEST_ASSET_PREFIX}95`, name: "Prototype probe" }],
      }),
    /no resolvable source data key/i,
    "an inherited prototype member must count as unresolved, not as a substitutable value",
  );

  const { rows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms.asset_points WHERE source_data_key LIKE '%native code%'`,
  );
  assert(
    Number(rows[0].n) === 0,
    "a stringified function must never reach source_data_key — apps/ingest reads it as wiring",
  );

  await cleanupAssets(pool);
}

/** Removes this suite's assets between cases, leaving the template in place. */
async function cleanupAssets(pool: pg.Pool): Promise<void> {
  await pool.query(
    `DELETE FROM bms.asset_points
      WHERE asset_id IN (SELECT id FROM bms.assets WHERE code LIKE $1)`,
    [`${TEST_ASSET_PREFIX}%`],
  );
  await pool.query(`DELETE FROM bms.assets WHERE code LIKE $1`, [`${TEST_ASSET_PREFIX}%`]);
}
