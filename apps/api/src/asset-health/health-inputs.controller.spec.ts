import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { AssetHealthInputsResponse, HealthBadActorsResponse, JwtPayload } from "@bms/shared";
import { expect } from "vitest";

import type { AccessControlService } from "../auth/access-control.service";
import { DEFAULT_HEALTH_WINDOW_MINUTES } from "./asset-health.schema";
import type { HealthLocationFilter } from "./asset-health.service";
import { HealthInputsController } from "./health-inputs.controller";
import type { HealthInputsService } from "./health-inputs.service";

/**
 * `E1.8a` / ADR 0050 Amendment 5 (plan T1.3, T1.6) — the two routes' order of
 * checks, with stubs (the `asset-health.controller.spec.ts` shape). The value
 * `readableAssetIds` (or `readableAssetIdsInOrganization`) returns is the value
 * the service gets, by reference; a scan cannot see that, so it is held here.
 * Entry point: `health-inputs.controller.test.ts` (ADR 0014).
 */
const USER: JwtPayload = { sub: "u1", email: "op@bms.local", name: "Operator", role: "viewer" };
const ASSET_ID = "88888888-8888-4888-8888-888888888888";
const LOCATION_ID = "99999999-9999-4999-8999-999999999999";
const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const INPUTS: AssetHealthInputsResponse = {
  assetId: ASSET_ID,
  asOf: "2026-11-17T10:30:00.000Z",
  inputs: [],
  anomalyHistory: null,
  maintenance: null,
};
const BAD_ACTORS: HealthBadActorsResponse = {
  asOf: "2026-11-17T10:30:00.000Z",
  scoredAssetCount: 0,
  lowestScores: [],
  anomaly: null,
};

type BadActorsCall = {
  assetIds: readonly string[] | null;
  location: HealthLocationFilter | undefined;
  windowMinutes: number;
  now: Date;
};

function harness(opts: {
  canReadAsset?: boolean;
  readableAssetIds?: readonly string[] | null;
  inOrganization?: readonly string[];
  readableLocationIds?: readonly string[] | null;
  readableOrganizationIds?: readonly string[] | null;
} = {}) {
  const access: string[] = [];
  const forAssetCalls: { assetId: string; now: Date }[] = [];
  const badActorsCalls: BadActorsCall[] = [];
  const accessControl = {
    canReadAsset: async (_user: JwtPayload, assetId: string) => {
      access.push(`canReadAsset:${assetId}`);
      return opts.canReadAsset ?? true;
    },
    readableAssetIds: async () => {
      access.push("readableAssetIds");
      return opts.readableAssetIds === undefined ? null : opts.readableAssetIds;
    },
    readableAssetIdsInOrganization: async (_user: JwtPayload, organizationId: string) => {
      access.push(`inOrganization:${organizationId}`);
      return opts.inOrganization ?? [];
    },
    readableLocationIds: async () => {
      access.push("readableLocationIds");
      return opts.readableLocationIds === undefined ? null : opts.readableLocationIds;
    },
    readableOrganizationIds: async () => {
      access.push("readableOrganizationIds");
      return opts.readableOrganizationIds === undefined ? null : opts.readableOrganizationIds;
    },
  } as unknown as AccessControlService;
  const service = {
    forAsset: async (assetId: string, now: Date) => {
      forAssetCalls.push({ assetId, now });
      return INPUTS;
    },
    badActors: async (
      assetIds: readonly string[] | null,
      location: HealthLocationFilter | undefined,
      windowMinutes: number,
      now: Date,
    ) => {
      badActorsCalls.push({ assetIds, location, windowMinutes, now });
      return BAD_ACTORS;
    },
  } as unknown as HealthInputsService;
  return { controller: new HealthInputsController(service, accessControl), access, forAssetCalls, badActorsCalls };
}

/** `inputs`: a non-UUID id is a 400 before `canReadAsset`; a denied asset is a 403 before the service. */
export async function theInputsRouteChecksTheIdThenTheAsset(): Promise<void> {
  const bad = harness();
  await expect(bad.controller.forAsset(USER, "not-a-uuid")).rejects.toBeInstanceOf(BadRequestException);
  expect(bad.access).toEqual([]);
  expect(bad.forAssetCalls).toEqual([]);

  const denied = harness({ canReadAsset: false });
  await expect(denied.controller.forAsset(USER, ASSET_ID)).rejects.toBeInstanceOf(ForbiddenException);
  expect(denied.access).toEqual([`canReadAsset:${ASSET_ID}`]);
  expect(denied.forAssetCalls).toEqual([]);

  const allowed = harness();
  expect(await allowed.controller.forAsset(USER, ASSET_ID)).toBe(INPUTS);
  expect(allowed.forAssetCalls).toHaveLength(1);
  expect(allowed.forAssetCalls[0]?.assetId).toBe(ASSET_ID);
  expect(allowed.forAssetCalls[0]?.now).toBeInstanceOf(Date);
}

/** `badActors`: a bad query is a 400 before any access call. */
export async function aBadQueryIsRefusedBeforeAccessControl(): Promise<void> {
  for (const query of [{ organizationId: "nope" }, { windowMinutes: "60" }, { assetGroupId: ORGANIZATION_ID }]) {
    const h = harness();
    await expect(h.controller.badActors(USER, query)).rejects.toBeInstanceOf(BadRequestException);
    expect(h.access, JSON.stringify(query)).toEqual([]);
    expect(h.badActorsCalls).toEqual([]);
  }
}

/** No key: `readableAssetIds`' value reaches the service unchanged — the same array, `[]`, or `null`. */
export async function theReadableSetReachesTheServiceUnchanged(): Promise<void> {
  const scope = [ASSET_ID, "77777777-7777-4777-8777-777777777777"];
  for (const readable of [scope, [], null] as const) {
    const h = harness({ readableAssetIds: readable });
    expect(await h.controller.badActors(USER, {})).toBe(BAD_ACTORS);
    expect(h.badActorsCalls).toHaveLength(1);
    expect(h.badActorsCalls[0]?.assetIds).toBe(readable);
    expect(h.badActorsCalls[0]?.location).toBeUndefined();
    expect(h.badActorsCalls[0]?.windowMinutes).toBe(DEFAULT_HEALTH_WINDOW_MINUTES);
    expect(h.badActorsCalls[0]?.now).toBeInstanceOf(Date);
    expect(h.access).toEqual(["readableAssetIds"]);
  }
}

/** `organizationId`: `readableAssetIdsInOrganization(user, id)` is what reaches the service, never the id itself. */
export async function theOrganizationNarrowsThroughTheIntersection(): Promise<void> {
  const narrowed = [ASSET_ID];
  const h = harness({ inOrganization: narrowed, readableAssetIds: ["should-not-be-used"] });
  await h.controller.badActors(USER, { organizationId: ORGANIZATION_ID.toUpperCase() });
  expect(h.access).toEqual([`inOrganization:${ORGANIZATION_ID}`]);
  expect(h.badActorsCalls[0]?.assetIds).toBe(narrowed);
}

/** `locationId`: the service gets the node with the caller's readable locations and organizations. */
export async function theLocationCarriesTheCallersReadableSets(): Promise<void> {
  const locations = [LOCATION_ID];
  const organizations = [ORGANIZATION_ID];
  const h = harness({ readableAssetIds: [ASSET_ID], readableLocationIds: locations, readableOrganizationIds: organizations });
  await h.controller.badActors(USER, { locationId: LOCATION_ID });
  const location = h.badActorsCalls[0]?.location;
  expect(location).toEqual({ id: LOCATION_ID, readableLocationIds: locations, readableOrganizationIds: organizations });
  expect(location?.readableLocationIds).toBe(locations);
  expect(location?.readableOrganizationIds).toBe(organizations);
  const admin = harness();
  await admin.controller.badActors(USER, { locationId: LOCATION_ID });
  expect(admin.badActorsCalls[0]?.location).toEqual({ id: LOCATION_ID, readableLocationIds: null, readableOrganizationIds: null });
}
