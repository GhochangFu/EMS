import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import { LocationAssetScopeService } from "./location-asset-scope.service";

/**
 * `F4.291` (ADR 0099 Amendment 9 E5; owner ruling P5) — `LocationAssetScopeService`
 * over a fake `fleetDb.execute` that logs each statement's SQL and parameters,
 * and a fake `AccessControlService` with a call log. The fake answers by the
 * statement's shape, not its semantics, so these claims pin what each
 * statement carries; the integration spec (`location-asset-scope.integration.spec.ts`)
 * proves what the database answers. Vitest entry point: the sibling `.test.ts`.
 */

const USER = { sub: "11111111-1111-4111-8111-111111111111", role: "location_admin" } as JwtPayload;
const ORG_A = "00000000-0000-4000-8000-0000000000aa";
const ORG_L = "00000000-0000-4000-8000-0000000000bb";
const SITE = "40000000-0000-4000-8000-000000000001";
const CHILD = "40000000-0000-4000-8000-000000000002";
const OTHER_SITE = "40000000-0000-4000-8000-000000000003";
const ASSET_1 = "30000000-0000-4000-8000-000000000001";
const ASSET_2 = "30000000-0000-4000-8000-000000000002";

const dialect = new PgDialect();

type Statement = { sql: string; params: unknown[] };

type FakeOptions = {
  /** The rows the placement statement answers. */
  placed?: Array<{ id: string; organization_id: string }>;
  subtree?: string[];
  readable?: string[];
  /** The rows the asset statement answers. */
  assets?: string[];
  /** `readableLocationIds`: `null` is the global admin. */
  readableLocations?: string[] | null;
};

function fake(options: FakeOptions = {}) {
  const statements: Statement[] = [];
  const accessCalls: Array<{ method: string; organizationId?: string }> = [];
  const fleetDb = {
    execute: async (query: SQL) => {
      const rendered = dialect.sqlToQuery(query);
      statements.push({ sql: rendered.sql, params: rendered.params });
      if (rendered.sql.includes("WITH RECURSIVE")) return { rows: (options.subtree ?? [SITE, CHILD]).map((id) => ({ id })) };
      if (rendered.sql.includes("bms.assets")) return { rows: (options.assets ?? []).map((id) => ({ id })) };
      return { rows: options.placed ?? [{ id: SITE, organization_id: ORG_A }] };
    },
  };
  const access = {
    readableAssetIdsInOrganization: async (_user: JwtPayload, organizationId: string) => {
      accessCalls.push({ method: "readableAssetIdsInOrganization", organizationId });
      return options.readable ?? [ASSET_1, ASSET_2];
    },
    readableLocationIds: async () => {
      accessCalls.push({ method: "readableLocationIds" });
      return options.readableLocations === undefined ? [SITE] : options.readableLocations;
    },
  };
  return { service: new LocationAssetScopeService(fleetDb as never, access as never), statements, accessCalls };
}

const placementOf = (statements: Statement[]) => statements[0];
const assetStatementOf = (statements: Statement[]) => statements.find((s) => s.sql.includes("bms.assets"));

/** The placement statement binds the location ids AND the candidate organizations. */
export async function thePlacementIsBoundToTheCandidateOrganizations(): Promise<void> {
  const { service, statements } = fake({ assets: [ASSET_1] });
  await service.readableAssetIdsInLocations(USER, [ORG_A, ORG_L], [SITE]);
  const placement = placementOf(statements);
  expect(placement?.sql).toMatch(/l\.id = ANY\(\$1::uuid\[\]\)\s+AND l\.organization_id = ANY\(\$2::uuid\[\]\)/);
  expect(placement?.params).toEqual([[SITE], [ORG_A, ORG_L]]);
}

/** A location the placement does not find is `not_found`, and no scope or asset read runs. */
export async function aLocationOutsideTheCandidatesIsNotFound(): Promise<void> {
  const { service, statements, accessCalls } = fake({ placed: [] });
  expect(await service.readableAssetIdsInLocations(USER, [ORG_A], [OTHER_SITE])).toEqual({ ok: false, reason: "not_found" });
  expect(statements).toHaveLength(1);
  expect(accessCalls).toEqual([]);
}

/** No location, or no candidate organization, is `not_found` without a statement. */
export async function noLocationOrNoCandidateIsNotFoundWithoutAStatement(): Promise<void> {
  const { service, statements } = fake();
  expect(await service.readableAssetIdsInLocations(USER, [ORG_A], [])).toEqual({ ok: false, reason: "not_found" });
  expect(await service.readableAssetIdsInLocations(USER, [], [SITE])).toEqual({ ok: false, reason: "not_found" });
  expect(statements).toEqual([]);
}

/** Two locations in two organizations are refused before any subtree walk. */
export async function locationsInTwoOrganizationsAreRefused(): Promise<void> {
  const { service, statements } = fake({
    placed: [
      { id: SITE, organization_id: ORG_A },
      { id: OTHER_SITE, organization_id: ORG_L },
    ],
  });
  expect(await service.readableAssetIdsInLocations(USER, [ORG_A, ORG_L], [SITE, OTHER_SITE])).toEqual({
    ok: false,
    reason: "several_organizations",
  });
  expect(statements).toHaveLength(1);
}

/** The readable ids are asked for the location's own organization, not the first candidate. */
export async function theReadableIdsAreAskedForTheLocationsOrganization(): Promise<void> {
  const { service, accessCalls } = fake({ placed: [{ id: SITE, organization_id: ORG_L }], assets: [ASSET_1] });
  const out = await service.readableAssetIdsInLocations(USER, [ORG_A, ORG_L], [SITE]);
  expect(accessCalls[0]).toEqual({ method: "readableAssetIdsInOrganization", organizationId: ORG_L });
  expect(out).toEqual({ ok: true, organizationId: ORG_L, assetIds: [ASSET_1] });
}

/** The subtree walk starts at the asked locations, bound to the placed organization. */
export async function theSubtreeWalkIsBoundToThePlacedOrganization(): Promise<void> {
  const { service, statements } = fake({ placed: [{ id: SITE, organization_id: ORG_L }], assets: [ASSET_1] });
  await service.readableAssetIdsInLocations(USER, [ORG_A, ORG_L], [SITE]);
  const walk = statements.find((s) => s.sql.includes("WITH RECURSIVE"));
  expect(walk?.params.slice(0, 2)).toEqual([[SITE], [ORG_L]]);
}

/** The asset statement intersects the subtree's locations with the caller's readable ids, sorted by id. */
export async function theAssetStatementIntersectsTheSubtreeAndTheReadableIds(): Promise<void> {
  const { service, statements } = fake({ subtree: [SITE, CHILD], readable: [ASSET_2], assets: [ASSET_2] });
  const out = await service.readableAssetIdsInLocations(USER, [ORG_A], [SITE]);
  const assets = assetStatementOf(statements);
  expect(assets?.sql).toMatch(/a\.location_id = ANY\(\$1::uuid\[\]\)\s+AND a\.id = ANY\(\$2::uuid\[\]\)\s+ORDER BY a\.id/);
  expect(assets?.params).toEqual([[SITE, CHILD], [ASSET_2]]);
  expect(out).toEqual({ ok: true, organizationId: ORG_A, assetIds: [ASSET_2] });
}

/** A caller with no readable asset in the organization makes no asset statement; the positive neighbour does. */
export async function anEmptyReadableSetMakesNoAssetStatement(): Promise<void> {
  const empty = fake({ readable: [] });
  expect(await empty.service.readableAssetIdsInLocations(USER, [ORG_A], [SITE])).toEqual({ ok: true, organizationId: ORG_A, assetIds: [] });
  expect(assetStatementOf(empty.statements)).toBeUndefined();
  const some = fake({ readable: [ASSET_1], assets: [ASSET_1] });
  await some.service.readableAssetIdsInLocations(USER, [ORG_A], [SITE]);
  expect(assetStatementOf(some.statements)).toBeDefined();
}

/** A found location with no readable asset under it and outside the caller's locations is `outside_grant`. */
export async function aLocationOutsideTheGrantIsRefused(): Promise<void> {
  const { service } = fake({ assets: [], readableLocations: [OTHER_SITE] });
  expect(await service.readableAssetIdsInLocations(USER, [ORG_A], [SITE])).toEqual({ ok: false, reason: "outside_grant" });
}

/** A location the caller reads that holds no readable asset is an empty answer, not a refusal. */
export async function anEmptySiteInsideTheGrantIsAnEmptyAnswer(): Promise<void> {
  const { service } = fake({ assets: [], readableLocations: [SITE] });
  expect(await service.readableAssetIdsInLocations(USER, [ORG_A], [SITE])).toEqual({ ok: true, organizationId: ORG_A, assetIds: [] });
}

/** For the global admin (`readableLocationIds` is `null`) a found location is never outside the grant. */
export async function aGlobalAdminIsNeverOutsideTheGrant(): Promise<void> {
  const { service } = fake({ assets: [], readableLocations: null });
  expect(await service.readableAssetIdsInLocations(USER, [ORG_A], [SITE])).toEqual({ ok: true, organizationId: ORG_A, assetIds: [] });
}

/** A non-empty answer never reads the location grant (the extra scope read is for the empty path only). */
export async function aNonEmptyAnswerReadsNoLocationGrant(): Promise<void> {
  const { service, accessCalls } = fake({ assets: [ASSET_1] });
  await service.readableAssetIdsInLocations(USER, [ORG_A], [SITE]);
  expect(accessCalls.map((call) => call.method)).toEqual(["readableAssetIdsInOrganization"]);
}
