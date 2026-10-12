import { createAssetBodySchema, updateAssetBodySchema } from "../../contracts/asset-writes";
import { emptyBody, fieldList, quoted, text, uuidParam } from "./summary-text";
import type { CatalogEntry, ExcludedRoute } from "./types";

const ASSET = { kind: "asset", param: "id" } as const;
const STEPS = [
  { id: "basics", title: "Basics", fields: ["code", "name", "siteName", "locationId", "rtuId"] },
  { id: "classification", title: "Classification", fields: ["domain", "waterBalanceRole", "rating", "tripCause"] },
  { id: "metadata", title: "Metadata", fields: ["meta"] },
] as const;

/** What an update's `locationId` does: nothing (absent), or a move to another site. */
function move(body: Readonly<Record<string, unknown>>): string {
  return typeof body.locationId === "string" ? `; moves it to location ${body.locationId}` : "";
}

/**
 * `F3.86` PR 3b (ADR 0099 release 2, plan §5.1) — the assets. One file per
 * area, so the wizard PRs never edit the same catalog file (plan §4.5).
 *
 * A create lives at the site its body's `locationId` names, with the route's
 * own check on that site (`parent`). An update is checked on the asset; one
 * that names `locationId` is a move, which the route also checks on the new
 * site (`AssetsAdminService.update`) — the resolver asks the same question.
 */
export const ASSET_ENTRIES: readonly CatalogEntry[] = [
  {
    id: "asset.create",
    title: "Create an asset",
    method: "POST",
    path: "/admin/assets",
    params: {},
    body: createAssetBodySchema,
    bodyName: "createAssetBodySchema",
    clientOnly: [],
    risk: "create",
    target: { kind: "parent", field: "locationId", of: "location" },
    refs: [{ field: "rtuId", kind: "rtu" }],
    formulas: [],
    steps: STEPS,
    summary: ({ body, targetName, organizationName }) =>
      `Create the asset ${quoted(text(body, "name"))} (${text(body, "code")}) at ${quoted(targetName)} in ${organizationName}.`,
  },
  {
    id: "asset.update",
    title: "Edit an asset",
    method: "PATCH",
    path: "/admin/assets/:id",
    params: { id: uuidParam },
    body: updateAssetBodySchema,
    bodyName: "updateAssetBodySchema",
    clientOnly: [],
    risk: "edit",
    target: ASSET,
    refs: [
      { field: "locationId", kind: "location" },
      { field: "rtuId", kind: "rtu" },
    ],
    formulas: [],
    steps: STEPS,
    summary: ({ body, targetName }) => `Change ${fieldList(body)} of the asset ${quoted(targetName)}${move(body)}.`,
  },
  {
    id: "asset.deactivate",
    title: "Deactivate an asset",
    method: "POST",
    path: "/admin/assets/:id/deactivate",
    params: { id: uuidParam },
    body: emptyBody,
    bodyName: null,
    clientOnly: [],
    risk: "deactivate",
    target: ASSET,
    refs: [],
    formulas: [],
    steps: [],
    summary: ({ targetName }) => `Deactivate the asset ${quoted(targetName)}.`,
  },
  {
    id: "asset.reactivate",
    title: "Reactivate an asset",
    method: "POST",
    path: "/admin/assets/:id/reactivate",
    params: { id: uuidParam },
    body: emptyBody,
    bodyName: null,
    clientOnly: [],
    risk: "edit",
    target: ASSET,
    refs: [],
    formulas: [],
    steps: [],
    summary: ({ targetName }) => `Reactivate the asset ${quoted(targetName)}.`,
  },
];

/** The area's write routes that are not entries. All four are entries since PR 3b. */
export const ASSET_PENDING: readonly ExcludedRoute[] = [];
