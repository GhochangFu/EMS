import { BadRequestException } from "@nestjs/common";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import type { AccessControlService } from "../auth/access-control.service";
import { MapController } from "./map.controller";
import type { MapService } from "./map.service";

/**
 * `F3.79` security review — `GET /map/sites` hands `sitesLive` the caller's location ids, so a
 * pin that joins a location is scoped by id (`map.integration.spec.ts` I4–I6 gate the filter).
 * Location names are tenant free text and not unique; a name-only scope showed another
 * organization's same-named location.
 *
 * Assertions live here; `map.controller.test.ts` is the Vitest entry point (ADR 0014).
 */

type SitesLiveOpts = Parameters<MapService["sitesLive"]>[0];

const JWT = { sub: "u1" } as unknown as JwtPayload;

function controllerFor(scope: unknown): { controller: MapController; calls: SitesLiveOpts[] } {
  const calls: SitesLiveOpts[] = [];
  const map = {
    sitesLive: async (opts: SitesLiveOpts) => {
      calls.push(opts);
      return [];
    },
  } as unknown as MapService;
  const accessControl = {
    currentUser: async () => ({ user: { id: "u1" }, scope }),
  } as unknown as AccessControlService;
  return { controller: new MapController(map, accessControl), calls };
}

/** C1 — a scoped caller: the location ids and names of its scope, and its asset ids. */
export async function aScopedCallerSendsItsLocationIds(): Promise<void> {
  const { controller, calls } = controllerFor({
    kind: "location",
    locations: [
      { id: "loc-a", code: "A", slug: "a", name: "Plant 1", type: "site", province: null },
      { id: "loc-b", code: "B", slug: "b", name: "Plant 2", type: "site", province: null },
    ],
    assetGroups: [],
    assetIds: ["asset-1"],
  });

  await controller.sites(JWT, {});
  expect(calls).toEqual([
    {
      allowedSiteNames: ["Plant 1", "Plant 2"],
      allowedLocationIds: ["loc-a", "loc-b"],
      assetIds: ["asset-1"],
      parentLocationId: null,
    },
  ]);
}

/** C2 — a global caller: no list at all, so nothing is filtered. */
export async function aGlobalCallerSendsNoScope(): Promise<void> {
  const { controller, calls } = controllerFor({
    kind: "global",
    locations: [],
    assetGroups: [],
    assetIds: [],
  });

  await controller.sites(JWT, {});
  expect(calls).toEqual([{ allowedSiteNames: null, allowedLocationIds: null, assetIds: null, parentLocationId: null }]);
}

const GLOBAL_SCOPE = { kind: "global", locations: [], assetGroups: [], assetIds: [] };
const PARENT = "7b405d8b-31a7-472d-b97f-4b62cbe9111e";

/** C3 — `F2.10` (ADR 0098 decision 11, B12): a valid `parentLocationId` reaches `sitesLive` unchanged. */
export async function aValidParentLocationIdIsPassedThrough(): Promise<void> {
  const { controller, calls } = controllerFor(GLOBAL_SCOPE);
  await controller.sites(JWT, { parentLocationId: PARENT });
  expect(calls).toEqual([{ allowedSiteNames: null, allowedLocationIds: null, assetIds: null, parentLocationId: PARENT }]);
}

/** C4 — a malformed `parentLocationId` is a 400 before the service runs. */
export async function aMalformedParentLocationIdIs400(): Promise<void> {
  const { controller, calls } = controllerFor(GLOBAL_SCOPE);
  await expect(controller.sites(JWT, { parentLocationId: "x" })).rejects.toBeInstanceOf(BadRequestException);
  expect(calls).toEqual([]);
}

/** C5 — the query schema is `.strict()`: an unknown key is a 400 before the service runs. */
export async function anUnknownQueryKeyIs400(): Promise<void> {
  const { controller, calls } = controllerFor(GLOBAL_SCOPE);
  await expect(controller.sites(JWT, { foo: "1" })).rejects.toBeInstanceOf(BadRequestException);
  expect(calls).toEqual([]);
}
