import { expect } from "vitest";

import { createLocationBodySchema, updateLocationBodySchema } from "../../contracts/location-writes";
import { createRtuBodySchema, updateRtuBodySchema } from "../../contracts/rtu-writes";
import { catalogEntry } from "./index";
import { emptyBody } from "./summary-text";
import type { CatalogEntry } from "./types";

/**
 * `F3.86` PR 3a (plan §5.1) — the location and RTU entries. The rules every
 * entry obeys are `catalog.spec.ts`; this file holds what is particular to
 * these eight. Vitest entry point: the sibling `.test.ts`.
 */

const ROW = "11111111-1111-4111-8111-111111111111";
const PARENT = "22222222-2222-4222-8222-222222222222";

function entry(id: string): CatalogEntry {
  const found = catalogEntry(id);
  if (!found) throw new Error(`no catalog entry ${id}`);
  return found;
}

function summary(id: string, body: Record<string, unknown>): string {
  return entry(id).summary({ body, params: { id: ROW }, targetName: "Lotapata", organizationName: "PHE West Bengal" });
}

/** Each location entry is its controller's route and body, with the target the route checks. */
export function theLocationEntriesAreTheControllersRoutes(): void {
  const create = entry("location.create");
  expect([create.method, create.path, create.body, create.risk]).toEqual(["POST", "/admin/locations", createLocationBodySchema, "create"]);
  expect(create.target).toEqual({ kind: "organization", manage: "location" });
  expect(create.refs).toEqual([{ field: "parentId", kind: "location" }]);
  const update = entry("location.update");
  expect([update.method, update.path, update.body, update.risk]).toEqual(["PATCH", "/admin/locations/:id", updateLocationBodySchema, "edit"]);
  expect(update.target).toEqual({ kind: "location", param: "id" });
  expect(update.refs).toEqual([{ field: "parentId", kind: "location" }]);
  const deactivate = entry("location.deactivate");
  expect([deactivate.path, deactivate.body, deactivate.risk]).toEqual(["/admin/locations/:id/deactivate", emptyBody, "deactivate"]);
  const reactivate = entry("location.reactivate");
  expect([reactivate.path, reactivate.body, reactivate.risk]).toEqual(["/admin/locations/:id/reactivate", emptyBody, "edit"]);
}

/** Each RTU entry is its controller's route and body; a create lives at the site its body names. */
export function theRtuEntriesAreTheControllersRoutes(): void {
  const create = entry("rtu.create");
  expect([create.method, create.path, create.body, create.risk]).toEqual(["POST", "/admin/rtus", createRtuBodySchema, "create"]);
  expect(create.target).toEqual({ kind: "parent", field: "locationId", of: "location" });
  const update = entry("rtu.update");
  expect([update.method, update.path, update.body, update.risk]).toEqual(["PATCH", "/admin/rtus/:id", updateRtuBodySchema, "edit"]);
  expect(update.target).toEqual({ kind: "rtu", param: "id" });
  expect(entry("rtu.deactivate").risk).toBe("deactivate");
  expect(entry("rtu.reactivate").risk).toBe("edit");
  expect(entry("rtu.deactivate").target).toEqual({ kind: "rtu", param: "id" });
}

/** The steps are the plan's: Basics, then Place or Source, then Metadata. */
export function theStepsAreThePlans(): void {
  expect(entry("location.create").steps.map((step) => step.id)).toEqual(["basics", "place", "metadata"]);
  expect(entry("location.create").steps[0]?.fields).toEqual(["organizationId", "code", "slug", "name", "type", "parentId"]);
  expect(entry("location.update").steps[0]?.fields).toEqual(["code", "slug", "name", "type", "parentId"]);
  expect(entry("rtu.create").steps.map((step) => step.id)).toEqual(["basics", "source", "metadata"]);
  expect(entry("rtu.create").steps[0]?.fields).toEqual(["locationId", "code", "displayName", "sourceType", "domain"]);
  expect(entry("rtu.update").steps[0]?.fields).toEqual(["code", "displayName", "sourceType", "domain"]);
  expect(entry("location.deactivate").steps).toEqual([]);
}

/** A location update that names `parentId` says it moves the location; one without it does not. */
export function aLocationMoveSaysSo(): void {
  const under = summary("location.update", { parentId: PARENT });
  expect(under).toContain("Lotapata");
  expect(under).toContain(`moves it under location ${PARENT}`);
  const root = summary("location.update", { parentId: null });
  expect(root).toContain("moves it to the top level");
  const rename = summary("location.update", { name: "Renamed" });
  expect(rename).toContain("Lotapata");
  expect(rename).not.toContain("moves");
}

/** A create names the new row and where it goes. */
export function aCreateNamesTheRowAndItsPlace(): void {
  const location = entry("location.create").summary({
    body: { name: "Pune Works", code: "PUNE-1" },
    params: {},
    targetName: "PHE West Bengal",
    organizationName: "PHE West Bengal",
  });
  expect(location).toBe('Create the location "Pune Works" (PUNE-1) in PHE West Bengal.');
  const rtu = entry("rtu.create").summary({
    body: { displayName: "Gateway Seven", code: "RTU-7" },
    params: {},
    targetName: "Lotapata",
    organizationName: "PHE West Bengal",
  });
  expect(rtu).toBe('Create the RTU "Gateway Seven" (RTU-7) at "Lotapata" in PHE West Bengal.');
}
