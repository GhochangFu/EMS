import { createAssetPointBodySchema, updateAssetPointBodySchema } from "../../contracts/asset-point-writes";
import { POINT_METADATA_FIELDS } from "../../contracts/point-metadata";
import { emptyBody, fieldList, quoted, text, uuidParam } from "./summary-text";
import type { CatalogEntry, ExcludedRoute } from "./types";

const ASSET_POINT = { kind: "assetPoint", param: "id" } as const;
const RTU_REF = [{ field: "rtuId", kind: "rtu" }] as const;
const INSTRUMENT = { id: "instrument", title: "Instrument", fields: POINT_METADATA_FIELDS } as const;

/**
 * `F3.86` PR 3b (ADR 0099 release 2, plan §5.1) — the asset points (point
 * mappings). One file per area, so the wizard PRs never edit the same catalog
 * file (plan §4.5).
 *
 * A create lives on the asset its body's `assetId` names, with the route's
 * own check on that asset (`parent`); every other write is checked on the
 * point's own asset. The bulk update and the mapping-sheet uploads stay out
 * (F4.254 ruling 3: the bulk update is a multi-target write, page-only for good;
 * the mapping-sheet uploads are multipart).
 */
export const ASSET_POINT_ENTRIES: readonly CatalogEntry[] = [
  {
    id: "assetPoint.create",
    title: "Map a point",
    method: "POST",
    path: "/admin/asset-points",
    params: {},
    body: createAssetPointBodySchema,
    bodyName: "createAssetPointBodySchema",
    clientOnly: [],
    risk: "create",
    target: { kind: "parent", field: "assetId", of: "asset" },
    refs: RTU_REF,
    formulas: [],
    steps: [
      { id: "mapping", title: "Mapping", fields: ["assetId", "pointKey", "sourceDataKey", "sensorCode", "unit", "rtuId"] },
      INSTRUMENT,
    ],
    summary: ({ body, targetName, organizationName }) =>
      `Map the point key ${quoted(text(body, "pointKey"))} from the source key ${quoted(text(body, "sourceDataKey"))} on the asset ${quoted(targetName)} in ${organizationName}.`,
  },
  {
    id: "assetPoint.update",
    title: "Edit a point mapping",
    method: "PATCH",
    path: "/admin/asset-points/:id",
    params: { id: uuidParam },
    body: updateAssetPointBodySchema,
    bodyName: "updateAssetPointBodySchema",
    clientOnly: [],
    risk: "edit",
    target: ASSET_POINT,
    refs: RTU_REF,
    formulas: [],
    steps: [
      { id: "mapping", title: "Mapping", fields: ["pointKey", "sourceDataKey", "sensorCode", "unit", "rtuId"] },
      INSTRUMENT,
    ],
    summary: ({ body, targetName }) => `Change ${fieldList(body)} of the point mapping ${quoted(targetName)}.`,
  },
  {
    id: "assetPoint.deactivate",
    title: "Deactivate a point mapping",
    method: "POST",
    path: "/admin/asset-points/:id/deactivate",
    params: { id: uuidParam },
    body: emptyBody,
    bodyName: null,
    clientOnly: [],
    risk: "deactivate",
    target: ASSET_POINT,
    refs: [],
    formulas: [],
    steps: [],
    summary: ({ targetName }) => `Deactivate the point mapping ${quoted(targetName)}.`,
  },
  {
    id: "assetPoint.reactivate",
    title: "Reactivate a point mapping",
    method: "POST",
    path: "/admin/asset-points/:id/reactivate",
    params: { id: uuidParam },
    body: emptyBody,
    bodyName: null,
    clientOnly: [],
    risk: "edit",
    target: ASSET_POINT,
    refs: [],
    formulas: [],
    steps: [],
    summary: ({ targetName }) => `Reactivate the point mapping ${quoted(targetName)}.`,
  },
];

const MULTIPART = "a multipart upload; the interceptor refuses multipart";
const MULTI_TARGET =
  "a multi-target write: one card names one target (an entry's target is one row); the page's bulk panel is the door (F4.254 ruling 3)";

/** The area's write routes that are not entries: each excluded for good (with the reason). */
export const ASSET_POINT_PENDING: readonly ExcludedRoute[] = [
  { method: "POST", path: "/admin/asset-points/mapping-sheet/preview", reason: MULTIPART },
  { method: "POST", path: "/admin/asset-points/mapping-sheet/commit", reason: MULTIPART },
  { method: "POST", path: "/admin/asset-points/bulk-update", reason: MULTI_TARGET },
];
