import { createLocationBodySchema, updateLocationBodySchema } from "../../contracts/location-writes";
import { emptyBody, fieldList, quoted, text, uuidParam } from "./summary-text";
import type { CatalogEntry, ExcludedRoute } from "./types";

const LOCATION = { kind: "location", param: "id" } as const;
const PARENT_REF = [{ field: "parentId", kind: "location" }] as const;
const PLACE = { id: "place", title: "Place", fields: ["province", "capital", "latitude", "longitude", "timezone"] } as const;
const METADATA = { id: "metadata", title: "Metadata", fields: ["meta"] } as const;

/** What an update's `parentId` does: nothing (absent), a move to the top level (`null`), or under a row. */
function move(body: Readonly<Record<string, unknown>>): string {
  if (!("parentId" in body)) return "";
  return body.parentId === null ? "; moves it to the top level" : `; moves it under location ${text(body, "parentId")}`;
}

/**
 * `F3.86` PR 3a (ADR 0099 release 2, plan §5.1) — the locations. One file per
 * area, so the wizard PRs never edit the same catalog file (plan §4.5).
 *
 * A create lives in the body's organization, with the route's check (no
 * `location_admin`, the organization managed). An update that names
 * `parentId` is a move, which the route allows an organization-level
 * administrator only; the resolver asks the same question.
 */
export const LOCATION_ENTRIES: readonly CatalogEntry[] = [
  {
    id: "location.create",
    title: "Create a location",
    method: "POST",
    path: "/admin/locations",
    params: {},
    body: createLocationBodySchema,
    bodyName: "createLocationBodySchema",
    clientOnly: [],
    risk: "create",
    target: { kind: "organization", manage: "location" },
    refs: PARENT_REF,
    formulas: [],
    steps: [
      { id: "basics", title: "Basics", fields: ["organizationId", "code", "slug", "name", "type", "parentId"] },
      PLACE,
      METADATA,
    ],
    summary: ({ body, organizationName }) =>
      `Create the location ${quoted(text(body, "name"))} (${text(body, "code")}) in ${organizationName}.`,
  },
  {
    id: "location.update",
    title: "Edit a location",
    method: "PATCH",
    path: "/admin/locations/:id",
    params: { id: uuidParam },
    body: updateLocationBodySchema,
    bodyName: "updateLocationBodySchema",
    clientOnly: [],
    risk: "edit",
    target: LOCATION,
    refs: PARENT_REF,
    formulas: [],
    steps: [{ id: "basics", title: "Basics", fields: ["code", "slug", "name", "type", "parentId"] }, PLACE, METADATA],
    summary: ({ body, targetName }) => `Change ${fieldList(body)} of the location ${quoted(targetName)}${move(body)}.`,
  },
  {
    id: "location.deactivate",
    title: "Deactivate a location",
    method: "POST",
    path: "/admin/locations/:id/deactivate",
    params: { id: uuidParam },
    body: emptyBody,
    bodyName: null,
    clientOnly: [],
    risk: "deactivate",
    target: LOCATION,
    refs: [],
    formulas: [],
    steps: [],
    summary: ({ targetName }) => `Deactivate the location ${quoted(targetName)}.`,
  },
  {
    id: "location.reactivate",
    title: "Reactivate a location",
    method: "POST",
    path: "/admin/locations/:id/reactivate",
    params: { id: uuidParam },
    body: emptyBody,
    bodyName: null,
    clientOnly: [],
    risk: "edit",
    target: LOCATION,
    refs: [],
    formulas: [],
    steps: [],
    summary: ({ targetName }) => `Reactivate the location ${quoted(targetName)}.`,
  },
];

/** The area's write routes that are not entries. All four are entries since PR 3a. */
export const LOCATION_PENDING: readonly ExcludedRoute[] = [];
