import type pg from "pg";
import { expect } from "vitest";

import { filterOptionsResponseSchema, type FilterOptionsResponse, type JwtPayload } from "@bms/shared";

import type { TreeFixture } from "../auth/location-tree.integration.spec";
import type { AssetFilterScopeService } from "./asset-filter-scope.service";
import type { FilterOptionsService } from "./filter-options.service";

/**
 * `F4.361` U3 (ADR 0132 decision 2, build notes 1 and 2, plan D9) —
 * `FilterOptionsService.options` on the real database, on the `F2.10` tree
 * fixture plus:
 *
 * - **G2**, a second group on A1 with A1's asset, granted to nobody;
 * - an **inactive asset** on A1, and an **inactive location** under A with
 *   an active asset on it;
 * - an **inactive organization** with an active site and an asset.
 *
 * None of the inactive rows, nor anything only reachable through them, may be
 * listed. Every expectation is computed from the fixture's ids; the admin's
 * answer is checked for the fixture rows it contains, never a table-wide
 * count. `filter-options.integration.test.ts` is the Vitest entry point.
 */

function fail(message: string): never {
  throw new Error(message);
}

type Node = keyof TreeFixture["nodes"];

export type InactiveRows = {
  readonly inactiveAsset: string;
  readonly inactiveLocation: string;
  readonly assetAtInactiveLocation: string;
  readonly inactiveOrg: string;
  readonly inactiveOrgSite: string;
  readonly inactiveOrgAsset: string;
};

async function domainCode(db: Pick<pg.Pool, "query">): Promise<string> {
  const { rows } = await db.query<{ code: string }>("SELECT code FROM bms.asset_domains ORDER BY code LIMIT 1");
  return rows[0]?.code ?? fail("bms.asset_domains is empty — run pnpm db:seed");
}

async function insertAsset(
  db: Pick<pg.Pool, "query">,
  input: { organizationId: string; locationId: string; code: string; active: boolean },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain, active)
     VALUES ($1, $2, $3, $3, 'F4.361 site', $4, $5) RETURNING id`,
    [input.organizationId, input.locationId, input.code, await domainCode(db), input.active],
  );
  return rows[0]?.id ?? fail(`asset ${input.code} was not inserted`);
}

async function insertLocation(
  db: Pick<pg.Pool, "query">,
  input: { organizationId: string; code: string; parentId: string | null; active: boolean },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude, parent_id, active)
     VALUES ($1, $2, $3, $2, 'smoc_campus', 0, 0, $4, $5) RETURNING id`,
    [input.organizationId, input.code, input.code.toLowerCase(), input.parentId, input.active],
  );
  return rows[0]?.id ?? fail(`location ${input.code} was not inserted`);
}

/** The inactive rows beside the tree. */
export async function insertInactiveRows(db: Pick<pg.Pool, "query">, fx: TreeFixture, run: string): Promise<InactiveRows> {
  const inactiveAsset = await insertAsset(db, { organizationId: fx.orgA, locationId: fx.nodes.A1, code: `F4361-${run}-OFF`, active: false });
  const inactiveLocation = await insertLocation(db, { organizationId: fx.orgA, code: `F4361-${run}-A2`, parentId: fx.nodes.A, active: false });
  const assetAtInactiveLocation = await insertAsset(db, {
    organizationId: fx.orgA,
    locationId: inactiveLocation,
    code: `F4361-${run}-A2-ASSET`,
    active: true,
  });
  const org = await db.query<{ id: string }>(
    `INSERT INTO bms.organizations (code, name, currency, active) VALUES ($1, $2, 'INR', false) RETURNING id`,
    [`F4361-OFF-${run}`, `F4.361 inactive ${run}`],
  );
  const inactiveOrg = org.rows[0]?.id ?? fail("the inactive organization was not inserted");
  const inactiveOrgSite = await insertLocation(db, { organizationId: inactiveOrg, code: `F4361-${run}-OFF-S`, parentId: null, active: true });
  const inactiveOrgAsset = await insertAsset(db, { organizationId: inactiveOrg, locationId: inactiveOrgSite, code: `F4361-${run}-OFF-S-ASSET`, active: true });
  return { inactiveAsset, inactiveLocation, assetAtInactiveLocation, inactiveOrg, inactiveOrgSite, inactiveOrgAsset };
}

export type OptionsFixture = {
  readonly options: FilterOptionsService;
  readonly narrow: AssetFilterScopeService;
  readonly fx: TreeFixture;
  readonly g2: string;
  readonly inactive: InactiveRows;
  readonly admin: JwtPayload;
};

const sorted = (ids: Iterable<string>): string[] => [...ids].sort();
const idsOf = (items: readonly { id: string }[]): string[] => sorted(items.map((item) => item.id));

function inactiveIds(f: OptionsFixture): string[] {
  return Object.values(f.inactive);
}

function expectNoInactiveRow(f: OptionsFixture, answer: FilterOptionsResponse, who: string): void {
  const text = JSON.stringify(answer);
  for (const id of inactiveIds(f)) expect(text.includes(id), `${who}: inactive row ${id} is listed`).toBe(false);
}

async function answerFor(f: OptionsFixture, user: JwtPayload): Promise<FilterOptionsResponse> {
  const answer = await f.options.options(user);
  const parsed = filterOptionsResponseSchema.safeParse(answer);
  expect(parsed.success, `the answer for ${user.email} must parse with the contract`).toBe(true);
  return answer;
}

const nodeIds = (f: OptionsFixture, nodes: readonly Node[]): string[] => sorted(nodes.map((n) => f.fx.nodes[n]));
const assetIds = (f: OptionsFixture, nodes: readonly Node[]): string[] => sorted(nodes.map((n) => f.fx.assets[n]));

/** `grantee` (location A): organization A, the subtree of A with A's parent masked, both groups on A1, the three assets. */
export async function aLocationGranteeListsItsSubtree(f: OptionsFixture): Promise<void> {
  const { fx } = f;
  const answer = await answerFor(f, fx.grantee);
  expect(idsOf(answer.organizations)).toEqual([fx.orgA]);
  expect(idsOf(answer.locations)).toEqual(nodeIds(f, ["A", "A1", "A1a"]));
  const parent = new Map(answer.locations.map((l) => [l.id, l.parentId]));
  expect(parent.get(fx.nodes.A), "R is unreadable: A.parentId is null").toBeNull();
  expect(parent.get(fx.nodes.A1)).toBe(fx.nodes.A);
  expect(parent.get(fx.nodes.A1a)).toBe(fx.nodes.A1);
  expect(answer.locations.every((l) => l.organizationId === fx.orgA)).toBe(true);
  expect(idsOf(answer.assetGroups), "G and G2 sit on A1, a readable location (build note 1)").toEqual(sorted([fx.groupId, f.g2]));
  for (const group of answer.assetGroups) expect(group.assetIds).toEqual([fx.assets.A1]);
  expect(idsOf(answer.assets)).toEqual(assetIds(f, ["A", "A1", "A1a"]));
  expectNoInactiveRow(f, answer, "grantee");
}

/** `groupAdmin` (G on A1): A1 with no parent, its granted group only — G2 on the same site is not listed. */
export async function anAssetGroupAdminListsItsGrantedGroupOnly(f: OptionsFixture): Promise<void> {
  const { fx } = f;
  const answer = await answerFor(f, fx.groupAdmin);
  expect(idsOf(answer.organizations)).toEqual([fx.orgA]);
  expect(answer.locations.map((l) => [l.id, l.parentId])).toEqual([[fx.nodes.A1, null]]);
  expect(answer.assetGroups.map((g) => [g.id, g.assetIds])).toEqual([[fx.groupId, [fx.assets.A1]]]);
  expect(idsOf(answer.assets)).toEqual([fx.assets.A1]);
}

/** `foreignOrgAdmin` (organization B): X and X1, and no id of organization A anywhere in the answer. */
export async function aForeignOrganizationAdminSeesNoOrganizationAId(f: OptionsFixture): Promise<void> {
  const { fx } = f;
  const answer = await answerFor(f, fx.foreignOrgAdmin);
  expect(idsOf(answer.organizations)).toEqual([fx.orgB]);
  expect(idsOf(answer.locations)).toEqual(nodeIds(f, ["X", "X1"]));
  expect(answer.assetGroups).toEqual([]);
  expect(idsOf(answer.assets)).toEqual(assetIds(f, ["X", "X1"]));
  const text = JSON.stringify(answer);
  const orgAIds = [fx.orgA, fx.groupId, f.g2, ...(["R", "A", "A1", "A1a", "B", "B1"] as const).flatMap((n) => [fx.nodes[n], fx.assets[n]])];
  for (const id of orgAIds) expect(text.includes(id), `organization A's id ${id} leaked to foreignOrgAdmin`).toBe(false);
}

/** The global admin: both fixture organizations, every fixture node, group and asset — and no inactive row. */
export async function theGlobalAdminListsBothFixtureOrganizations(f: OptionsFixture): Promise<void> {
  const { fx } = f;
  const answer = await answerFor(f, f.admin);
  const orgs = new Set(answer.organizations.map((o) => o.id));
  expect(orgs.has(fx.orgA) && orgs.has(fx.orgB), "the admin lists both fixture organizations").toBe(true);
  const locations = new Map(answer.locations.map((l) => [l.id, l]));
  for (const node of Object.keys(fx.nodes) as Node[]) expect(locations.has(fx.nodes[node]), `admin: node ${node}`).toBe(true);
  expect(locations.get(fx.nodes.R)?.parentId).toBeNull();
  expect(locations.get(fx.nodes.B1)?.parentId).toBe(fx.nodes.B);
  expect(locations.get(fx.nodes.X)?.organizationId).toBe(fx.orgB);
  const groups = new Set(answer.assetGroups.map((g) => g.id));
  expect(groups.has(fx.groupId) && groups.has(f.g2), "the admin lists G and G2").toBe(true);
  const assets = new Set(answer.assets.map((a) => a.id));
  for (const node of Object.keys(fx.assets) as Node[]) expect(assets.has(fx.assets[node]), `admin: asset ${node}`).toBe(true);
  expectNoInactiveRow(f, answer, "admin");
}

/** Every listed group passes `narrow`'s group check, and narrows to exactly the members the option lists. */
export async function everyListedGroupNarrowsToItsListedMembers(f: OptionsFixture): Promise<void> {
  const { fx } = f;
  for (const user of [fx.grantee, fx.groupAdmin, fx.foreignOrgAdmin, f.admin]) {
    const answer = await f.options.options(user);
    for (const group of answer.assetGroups.filter((g) => g.organizationId === fx.orgA || g.organizationId === fx.orgB)) {
      const narrowed = await f.narrow.narrow(user, { assetGroupId: group.id });
      expect(sorted(narrowed ?? []), `${user.email}: group ${group.code}`).toEqual(sorted(group.assetIds));
    }
  }
}
