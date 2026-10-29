import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import type { LocationAssetScope } from "../auth/location-asset-scope.service";
import {
  LOCATION_IDS_OUTSIDE_ORGANIZATION,
  LOCATION_IDS_OUTSIDE_SCOPE,
  LOCATION_IDS_SEVERAL_ORGANIZATIONS,
  ReportScopeService,
} from "./report-scope";

/**
 * `F4.290` (ADR 0099 Amendment 9 E4; owner ruling P5) — `ReportScopeService`,
 * the report routes' thin seam over `LocationAssetScopeService`, over fakes
 * with call logs. What the database answers for a subtree and a scope is the
 * shared service's (`auth/location-asset-scope.integration.spec.ts`) and
 * `report-scope.integration.spec.ts`'s. Vitest entry point: the sibling `.test.ts`.
 */

const USER = { sub: "11111111-1111-4111-8111-111111111111", role: "location_admin" } as JwtPayload;
const ORG_A = "00000000-0000-4000-8000-0000000000aa";
const ORG_B = "00000000-0000-4000-8000-0000000000bb";
const SITE = "40000000-0000-4000-8000-000000000001";
const ASSET_1 = "30000000-0000-4000-8000-000000000001";
const ASSET_2 = "30000000-0000-4000-8000-000000000002";

type Options = {
  readableAssets?: string[] | null;
  readableOrganizations?: string[] | null;
  /** The organizations the fleet read answers for the named locations (the global admin's candidates). */
  locationOrganizations?: string[];
  place?: LocationAssetScope;
};

function fake(options: Options = {}) {
  const placeCalls: Array<{ candidates: readonly string[]; locationIds: readonly string[] }> = [];
  const fleetReads: string[][] = [];
  const access = {
    readableAssetIds: async () => (options.readableAssets === undefined ? [ASSET_1, ASSET_2] : options.readableAssets),
    readableOrganizationIds: async () => (options.readableOrganizations === undefined ? [ORG_A] : options.readableOrganizations),
  };
  const fleetDb = {
    selectDistinct: () => ({
      from: () => ({
        where: async () => {
          fleetReads.push(options.locationOrganizations ?? []);
          return (options.locationOrganizations ?? []).map((organizationId) => ({ organizationId }));
        },
      }),
    }),
  };
  const locationScope = {
    readableAssetIdsInLocations: async (_user: JwtPayload, candidates: readonly string[], locationIds: readonly string[]) => {
      placeCalls.push({ candidates, locationIds });
      return options.place ?? { ok: true as const, organizationId: ORG_A, assetIds: [ASSET_1] };
    },
  };
  return { service: new ReportScopeService(fleetDb as never, access as never, locationScope), placeCalls, fleetReads };
}

async function thrown(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected a refusal, and the call resolved");
}

/** No `locationIds`: the caller's readable asset ids, exactly as the routes read them before. */
export async function noLocationIdsReadsTheCallersReadableAssets(): Promise<void> {
  const { service } = fake({ readableAssets: [ASSET_2] });
  expect(await service.assetIdsForCaller(USER, undefined)).toEqual([ASSET_2]);
}

/** No `locationIds`: the shared location service is never called (the critic's regression). */
export async function noLocationIdsNeverCallsTheLocationService(): Promise<void> {
  const { service, placeCalls } = fake();
  await service.assetIdsForCaller(USER, undefined);
  expect(placeCalls).toEqual([]);
}

/** Named sites: the shared service's asset ids are the answer, not the caller's whole readable set. */
export async function namedSitesReadTheSubtreesReadableAssets(): Promise<void> {
  const { service } = fake({ place: { ok: true, organizationId: ORG_A, assetIds: [ASSET_1] } });
  expect(await service.assetIdsForCaller(USER, [SITE])).toEqual([ASSET_1]);
}

/** Named sites: the candidates are the organizations the caller reads. */
export async function theCandidatesAreTheCallersReadableOrganizations(): Promise<void> {
  const { service, placeCalls } = fake({ readableOrganizations: [ORG_A, ORG_B] });
  await service.assetIdsForCaller(USER, [SITE]);
  expect(placeCalls).toEqual([{ candidates: [ORG_A, ORG_B], locationIds: [SITE] }]);
}

/** The global admin (`readableOrganizationIds` null): the candidates are the named locations' own organizations. */
export async function theGlobalAdminsCandidatesAreTheLocationsOrganizations(): Promise<void> {
  const { service, placeCalls } = fake({ readableOrganizations: null, locationOrganizations: [ORG_B] });
  await service.assetIdsForCaller(USER, [SITE]);
  expect(placeCalls[0]?.candidates).toEqual([ORG_B]);
}

/** A caller with an organization scope never reads the locations' organizations on the fleet pool. */
export async function aScopedCallerNeverReadsTheLocationsOrganizations(): Promise<void> {
  const { service, fleetReads } = fake({ readableOrganizations: [ORG_A], locationOrganizations: [ORG_B] });
  await service.assetIdsForCaller(USER, [SITE]);
  expect(fleetReads).toEqual([]);
}

/** `not_found` is a 400 with the schedule's own sentence. */
export async function aLocationNotFoundIsA400(): Promise<void> {
  const { service } = fake({ place: { ok: false, reason: "not_found" } });
  const err = await thrown(service.assetIdsForCaller(USER, [SITE]));
  expect([err instanceof BadRequestException, (err as Error).message]).toEqual([true, LOCATION_IDS_OUTSIDE_ORGANIZATION]);
}

/** `outside_grant` is a 403 with the schedule's own sentence. */
export async function aLocationOutsideTheGrantIsA403(): Promise<void> {
  const { service } = fake({ place: { ok: false, reason: "outside_grant" } });
  const err = await thrown(service.assetIdsForCaller(USER, [SITE]));
  expect([err instanceof ForbiddenException, (err as Error).message]).toEqual([true, LOCATION_IDS_OUTSIDE_SCOPE]);
}

/** `several_organizations` is a 400 that says so. */
export async function locationsOfSeveralOrganizationsAreA400(): Promise<void> {
  const { service } = fake({ place: { ok: false, reason: "several_organizations" } });
  const err = await thrown(service.assetIdsForCaller(USER, [SITE]));
  expect([err instanceof BadRequestException, (err as Error).message]).toEqual([true, LOCATION_IDS_SEVERAL_ORGANIZATIONS]);
}

/** The save's read: the one organization it resolved is the only candidate. */
export async function theSavesReadIsBoundToItsOrganization(): Promise<void> {
  const { service, placeCalls } = fake({ readableOrganizations: [ORG_A, ORG_B] });
  await service.assetIdsInOrganization(USER, ORG_B, [SITE]);
  expect(placeCalls).toEqual([{ candidates: [ORG_B], locationIds: [SITE] }]);
}
