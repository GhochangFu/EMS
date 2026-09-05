import { randomUUID } from "node:crypto";

import type pg from "pg";

import { assetGroupMembers, assetGroups, assetPoints, assets, assetTemplates, createDb, templatePoints } from "@bms/db";
import type { BmsDb } from "@bms/db";
import { CALC_DIALECT_V2, crossRefKey, parseFormula } from "@bms/shared";
import type { CalcCrossRef } from "@bms/shared";

import type { Fixtures } from "../admin/asset-templates/asset-templates.instantiate.integration.spec";
import type { Membership } from "./calc-graph";
import { CalcScopeService } from "./calc-scope.service";

/**
 * `F2.9` Task 11 — `CalcScopeService` against a real database (ADR 0055
 * decision 12). Reuses `loadFixtures` from the `F2.2` instantiation suite for
 * the three locations it needs — two in one organization, one in another —
 * then writes `asset_templates`/`template_points`/`assets`/`asset_points`/
 * `asset_groups`/`asset_group_members` rows directly. This suite is about
 * what the resolver does with rows already in the database, not about how
 * they got there.
 *
 * The fixture, all at `fx.rtuLocationId` (location 1) unless said otherwise:
 *
 * - **X** — the owner; pinned to a published template that declares the key.
 * - **Y** — `hvac`, pinned to the same template; member of `IT_LOAD` at
 *   location 1.
 * - **Z** — hand-created (`template_id` NULL), declares the key only through
 *   an active `asset_points` row — the disjunction's second half.
 * - **V** — `hvac`, hand-created, an **inactive** `asset_points` row for the
 *   key — declares nothing, so never a member.
 * - **I** — `hvac`, pinned to the template, `active = false` — never a member.
 * - **W** — `hvac`, pinned to the template, at `fx.otherLocationId`
 *   (location 2, same organization); member of a **second** `IT_LOAD` at
 *   location 2.
 * - **F** — `hvac`, hand-created with an active mapping, at
 *   `fx.foreignLocationId` (another organization).
 *
 * Every cross-reference node comes from `parseFormula` under `v2`, and every
 * `members` key from `crossRefKey()` — never hand-written (plan correction
 * 49).
 */

/** Per-run, so two instances of this file never delete each other's rows
 * (`tests/integration-fixture-isolation.test.ts`). */
export const TEST_CODE = `F29-CALCSCOPE-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;

/** The one point key the fixture declares. Per-run too: `registerFixturePointKeys`
 * removes only what it inserted, and a shared code under a concurrent instance
 * would be deleted from under the other's `template_points` rows. */
export const FIXTURE_POINT_KEY = `CALCSCOPE_KW_${TEST_CODE.slice(-10)}`;

export type ScopeFixture = {
  readonly x: string;
  readonly y: string;
  readonly z: string;
  readonly v: string;
  readonly i: string;
  readonly w: string;
  readonly f: string;
  readonly codes: { readonly y: string; readonly w: string; readonly f: string };
  readonly groupCode: string;
};

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Children first: mappings and memberships, then groups, assets, templates. */
export async function cleanup(pool: pg.Pool): Promise<void> {
  await pool.query(
    `DELETE FROM bms.asset_points
      WHERE asset_id IN (SELECT id FROM bms.assets WHERE code LIKE $1)`,
    [`${TEST_CODE}%`],
  );
  await pool.query(
    `DELETE FROM bms.asset_group_members
      WHERE asset_group_id IN (SELECT id FROM bms.asset_groups WHERE code LIKE $1)`,
    [`${TEST_CODE}%`],
  );
  await pool.query(`DELETE FROM bms.asset_groups WHERE code LIKE $1`, [`${TEST_CODE}%`]);
  await pool.query(`DELETE FROM bms.assets WHERE code LIKE $1`, [`${TEST_CODE}%`]);
  // template_points cascade on the FK.
  await pool.query(`DELETE FROM bms.asset_templates WHERE code LIKE $1`, [`${TEST_CODE}%`]);
}

export async function seedScopeFixture(pool: pg.Pool, fx: Fixtures): Promise<ScopeFixture> {
  const db = createDb(pool);
  const { rows: foreign } = await pool.query<{ organization_id: string }>(
    `SELECT organization_id FROM bms.locations WHERE id = $1`,
    [fx.foreignLocationId],
  );
  const foreignOrganizationId = foreign[0]?.organization_id;
  assert(foreignOrganizationId !== undefined, "the foreign location must resolve to its organization");

  const [template] = await db
    .insert(assetTemplates)
    .values({
      organizationId: fx.organizationId,
      code: TEST_CODE,
      version: 1,
      name: "Calc Scope Fixture",
      assetType: "test_rig",
      domain: "electrical",
      status: "published",
      publishedAt: new Date(),
    })
    .returning({ id: assetTemplates.id });
  await db.insert(templatePoints).values({
    organizationId: fx.organizationId,
    templateId: template.id,
    pointKey: FIXTURE_POINT_KEY,
    kind: "measured",
    sortOrder: 0,
  });

  const asset = (
    suffix: string,
    row: {
      locationId: string;
      domain: string;
      templateId: string | null;
      organizationId?: string;
      active?: boolean;
    },
  ) => ({
    code: `${TEST_CODE}-${suffix}`,
    name: `Calc scope fixture ${suffix}`,
    siteName: "Calc scope fixture site",
    organizationId: row.organizationId ?? fx.organizationId,
    locationId: row.locationId,
    domain: row.domain,
    templateId: row.templateId,
    active: row.active ?? true,
  });
  const rows = await db
    .insert(assets)
    .values([
      asset("X", { locationId: fx.rtuLocationId, domain: "electrical", templateId: template.id }),
      asset("Y", { locationId: fx.rtuLocationId, domain: "hvac", templateId: template.id }),
      asset("Z", { locationId: fx.rtuLocationId, domain: "electrical", templateId: null }),
      asset("V", { locationId: fx.rtuLocationId, domain: "hvac", templateId: null }),
      asset("I", { locationId: fx.rtuLocationId, domain: "hvac", templateId: template.id, active: false }),
      asset("W", { locationId: fx.otherLocationId, domain: "hvac", templateId: template.id }),
      asset("F", {
        locationId: fx.foreignLocationId,
        domain: "hvac",
        templateId: null,
        organizationId: foreignOrganizationId,
      }),
    ])
    .returning({ id: assets.id, code: assets.code });
  const idOf = (suffix: string): string => {
    const row = rows.find((r) => r.code === `${TEST_CODE}-${suffix}`);
    assert(row !== undefined, `fixture asset ${suffix} was not inserted`);
    return (row as { id: string }).id;
  };
  const ids = { x: idOf("X"), y: idOf("Y"), z: idOf("Z"), v: idOf("V"), i: idOf("I"), w: idOf("W"), f: idOf("F") };

  // Z and F declare the key by mapping alone; V's mapping is inactive.
  // `manual` needs no RTU (asset_points_source_ref_check).
  const mapping = (assetId: string, organizationId: string, active: boolean) => ({
    organizationId,
    assetId,
    pointKey: FIXTURE_POINT_KEY,
    sourceDataKey: "manual",
    sourceKind: "manual",
    active,
  });
  await db.insert(assetPoints).values([
    mapping(ids.z, fx.organizationId, true),
    mapping(ids.v, fx.organizationId, false),
    mapping(ids.f, foreignOrganizationId, true),
  ]);

  // Two groups, one code, two locations — `asset_groups_location_code_idx`
  // makes the pair unique per location and is what the group scope leans on.
  const groupCode = `${TEST_CODE}-IT_LOAD`;
  const [group1, group2] = await db
    .insert(assetGroups)
    .values([
      { organizationId: fx.organizationId, locationId: fx.rtuLocationId, code: groupCode, name: "IT load (location 1)" },
      { organizationId: fx.organizationId, locationId: fx.otherLocationId, code: groupCode, name: "IT load (location 2)" },
    ])
    .returning({ id: assetGroups.id });
  await db.insert(assetGroupMembers).values([
    { assetGroupId: group1.id, assetId: ids.y },
    { assetGroupId: group2.id, assetId: ids.w },
  ]);

  return {
    ...ids,
    codes: { y: `${TEST_CODE}-Y`, w: `${TEST_CODE}-W`, f: `${TEST_CODE}-F` },
    groupCode,
  };
}

/** The cross-reference nodes of one `v2` formula, exactly as the engine parses them. */
function crossRefsOf(expression: string): CalcCrossRef[] {
  const parsed = parseFormula(expression, { dialect: CALC_DIALECT_V2 });
  if (!parsed.ok) {
    throw new Error(`fixture formula ${JSON.stringify(expression)} must parse under v2: ${JSON.stringify(parsed.errors)}`);
  }
  assert(parsed.crossRefs.length > 0, `fixture formula ${JSON.stringify(expression)} must carry a cross reference`);
  return parsed.crossRefs;
}

function memberIds(membership: Membership, owner: string, ref: CalcCrossRef): string[] {
  const forOwner = membership.members.get(owner);
  assert(forOwner !== undefined, "the owner must have a members entry");
  const pairs = forOwner?.get(crossRefKey(ref));
  assert(pairs !== undefined, `the owner's members map must carry ${crossRefKey(ref)}`);
  return [...(pairs ?? [])].map((pair) => pair.assetId).sort();
}

function sorted(ids: readonly string[]): string[] {
  return [...ids].sort();
}

// --- `@site` --------------------------------------------------------------

/** The owner is in its own member set — the one-edge self-cycle is visible. */
export async function assertSiteIncludesTheOwner(pool: pg.Pool, fixture: ScopeFixture): Promise<void> {
  const svc = new CalcScopeService(createDb(pool));
  const [ref] = crossRefsOf(`sum({${FIXTURE_POINT_KEY}} @site)`);
  const membership = await svc.resolveMembership([{ assetId: fixture.x, crossRefs: [ref] }]);
  assert(
    memberIds(membership, fixture.x, ref).includes(fixture.x),
    "@site on X must include X itself: X declares the key, and a site sum that reads its own " +
      "output must be a one-edge cycle buildCalcGraph can see, not an invisible one",
  );
}

/** The disjunction's second half: an active mapping with no template declaration. */
export async function assertSiteIncludesAMappedHandCreatedAsset(pool: pg.Pool, fixture: ScopeFixture): Promise<void> {
  const svc = new CalcScopeService(createDb(pool));
  const [ref] = crossRefsOf(`sum({${FIXTURE_POINT_KEY}} @site)`);
  const membership = await svc.resolveMembership([{ assetId: fixture.x, crossRefs: [ref] }]);
  assert(
    memberIds(membership, fixture.x, ref).includes(fixture.z),
    "@site on X must include Z, which declares the key only through an active asset_points row " +
      "(hand-created, template_id NULL) — a mapped tag has real telemetry and must not go missing from a site sum",
  );
}

/** Exactly the declarers at the owner's location, and nothing else. */
export async function assertSiteIsExactlyTheDeclarersAtTheOwnersLocation(
  pool: pg.Pool,
  fixture: ScopeFixture,
): Promise<void> {
  const svc = new CalcScopeService(createDb(pool));
  const [ref] = crossRefsOf(`sum({${FIXTURE_POINT_KEY}} @site)`);
  const membership = await svc.resolveMembership([{ assetId: fixture.x, crossRefs: [ref] }]);
  const ids = memberIds(membership, fixture.x, ref);
  assert(!ids.includes(fixture.w), "W is at location 2 and must not be a member of X's @site");
  assert(!ids.includes(fixture.f), "F is in another organization and must not be a member of X's @site");
  assert(!ids.includes(fixture.v), "V declares the key only through an inactive mapping and must not be a member");
  assert(!ids.includes(fixture.i), "I is inactive and must not be a member, although its template declares the key");
  assert(
    JSON.stringify(ids) === JSON.stringify(sorted([fixture.x, fixture.y, fixture.z])),
    `@site on X must be exactly {X, Y, Z}, got ${JSON.stringify(ids)}`,
  );
  const pairs = membership.members.get(fixture.x)?.get(crossRefKey(ref)) ?? [];
  assert(
    pairs.every((pair) => pair.pointKey === FIXTURE_POINT_KEY),
    "every member pair must carry the aggregate's point key",
  );
}

// --- `@domain` and `@group` -----------------------------------------------

export async function assertDomainNarrowsToTheDeclarersInThatDomain(
  pool: pg.Pool,
  fixture: ScopeFixture,
): Promise<void> {
  const svc = new CalcScopeService(createDb(pool));
  const [ref] = crossRefsOf(`avg({${FIXTURE_POINT_KEY}} @domain('hvac'))`);
  const membership = await svc.resolveMembership([{ assetId: fixture.x, crossRefs: [ref] }]);
  const ids = memberIds(membership, fixture.x, ref);
  assert(
    JSON.stringify(ids) === JSON.stringify([fixture.y]),
    `@domain('hvac') on X must be exactly {Y} — V, I, W and F are hvac too and are excluded for four ` +
      `different reasons — got ${JSON.stringify(ids)}`,
  );
}

/**
 * Two groups carry the same code at two locations. X's `@group` resolves at
 * location 1 and finds Y; W's resolves at location 2, in the **same batched
 * call**, and finds W. This is the `(location_id, code)` uniqueness argument
 * proved, not assumed.
 */
export async function assertGroupResolvesAtTheOwnersLocationOnly(pool: pg.Pool, fixture: ScopeFixture): Promise<void> {
  const svc = new CalcScopeService(createDb(pool));
  const [ref] = crossRefsOf(`sum({${FIXTURE_POINT_KEY}} @group('${fixture.groupCode}'))`);
  const membership = await svc.resolveMembership([
    { assetId: fixture.x, crossRefs: [ref] },
    { assetId: fixture.w, crossRefs: [ref] },
  ]);
  const forX = memberIds(membership, fixture.x, ref);
  assert(!forX.includes(fixture.w), "W is in the location-2 group of the same code and must not be a member for X");
  assert(
    JSON.stringify(forX) === JSON.stringify([fixture.y]),
    `@group on X must be exactly {Y}, got ${JSON.stringify(forX)}`,
  );
  const forW = memberIds(membership, fixture.w, ref);
  assert(
    JSON.stringify(forW) === JSON.stringify([fixture.w]),
    `@group on W must be exactly {W} — the same code resolved at W's own location — got ${JSON.stringify(forW)}`,
  );
}

// --- qualified codes ------------------------------------------------------

/**
 * `{CODE.key}` resolves only at the owner's location. W's code exists — at
 * location 2 — and must be `null`, present in the map; F's likewise. Y's
 * resolves. `null` rather than absent, so a caller can tell "not resolved"
 * from "never asked".
 */
export async function assertQualifiedCodesAreContainedByTheOwnersLocation(
  pool: pg.Pool,
  fixture: ScopeFixture,
): Promise<void> {
  const svc = new CalcScopeService(createDb(pool));
  const { y, w, f } = fixture.codes;
  const refs = crossRefsOf(
    `{${w}.${FIXTURE_POINT_KEY}} + {${f}.${FIXTURE_POINT_KEY}} + {${y}.${FIXTURE_POINT_KEY}}`,
  );
  assert(refs.length === 3, `expected three qualified references, got ${refs.length}`);
  const membership = await svc.resolveMembership([{ assetId: fixture.x, crossRefs: refs }]);
  const forX = membership.qualified.get(fixture.x);
  assert(forX !== undefined, "X must have a qualified entry");
  for (const code of [w, f, y]) {
    assert(forX?.has(code) === true, `the qualified map must carry ${code} whether or not it resolved`);
  }
  assert(
    forX?.get(w) === null,
    `W's code names an asset at location 2 and must resolve to null for X, got ${String(forX?.get(w))}`,
  );
  assert(
    forX?.get(f) === null,
    `F's code names an asset in another organization and must resolve to null for X, got ${String(forX?.get(f))}`,
  );
  assert(forX?.get(y) === fixture.y, `Y's code is at X's location and must resolve to Y's id, got ${String(forX?.get(y))}`);
}

// --- edges ----------------------------------------------------------------

/** An owner whose asset row does not exist resolves to null / [] with every key present. */
export async function assertAnUnknownOwnerResolvesToNullAndEmpty(pool: pg.Pool, fixture: ScopeFixture): Promise<void> {
  const svc = new CalcScopeService(createDb(pool));
  const ghost = randomUUID();
  const [aggregate] = crossRefsOf(`sum({${FIXTURE_POINT_KEY}} @site)`);
  const [qref] = crossRefsOf(`{${fixture.codes.y}.${FIXTURE_POINT_KEY}}`);
  const membership = await svc.resolveMembership([{ assetId: ghost, crossRefs: [aggregate, qref] }]);
  assert(membership.qualified.get(ghost)?.get(fixture.codes.y) === null, "an unknown owner's qualified code must be null");
  assert(
    JSON.stringify(memberIds(membership, ghost, aggregate)) === "[]",
    "an unknown owner's aggregate must have no members",
  );
}

/** No cross references anywhere → empty maps, and the database is never touched. */
export async function assertNoCrossRefsQueriesNothing(fixture: ScopeFixture): Promise<void> {
  const refusingDb = {
    execute: () => {
      throw new Error("resolveMembership must not query when no definition holds a cross reference");
    },
  } as unknown as BmsDb;
  const svc = new CalcScopeService(refusingDb);
  const empty = await svc.resolveMembership([]);
  assert(empty.qualified.size === 0 && empty.members.size === 0, "an empty input must resolve to empty maps");
  const local = await svc.resolveMembership([{ assetId: fixture.x, crossRefs: [] }]);
  assert(
    local.qualified.size === 0 && local.members.size === 0,
    "a v1-only definition set must resolve to empty maps",
  );
}
