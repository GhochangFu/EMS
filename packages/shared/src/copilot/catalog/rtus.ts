import { createRtuBodySchema, updateRtuBodySchema } from "../../contracts/rtu-writes";
import { emptyBody, fieldList, quoted, text, uuidParam } from "./summary-text";
import type { CatalogEntry, ExcludedRoute } from "./types";

const RTU = { kind: "rtu", param: "id" } as const;
const SOURCE = {
  id: "source",
  title: "Source",
  fields: ["mqttTopic", "externalRtuId", "rtuCode", "stationCode", "stationName", "ingestEnabled"],
} as const;
const METADATA = { id: "metadata", title: "Metadata", fields: ["meta"] } as const;

/**
 * `F3.86` PR 3a (ADR 0099 release 2, plan §5.1) — the RTUs. One file per
 * area, so the wizard PRs never edit the same catalog file (plan §4.5).
 *
 * A create lives at the site its body's `locationId` names, with the route's
 * own check on that site (`parent`); an update cannot move an RTU (the body
 * has no `locationId`), so the RTU's own site is the one checked.
 */
export const RTU_ENTRIES: readonly CatalogEntry[] = [
  {
    id: "rtu.create",
    title: "Create an RTU",
    method: "POST",
    path: "/admin/rtus",
    params: {},
    body: createRtuBodySchema,
    bodyName: "createRtuBodySchema",
    clientOnly: [],
    risk: "create",
    target: { kind: "parent", field: "locationId", of: "location" },
    refs: [],
    formulas: [],
    steps: [
      { id: "basics", title: "Basics", fields: ["locationId", "code", "displayName", "sourceType", "domain"] },
      SOURCE,
      METADATA,
    ],
    summary: ({ body, targetName, organizationName }) =>
      `Create the RTU ${quoted(text(body, "displayName"))} (${text(body, "code")}) at ${quoted(targetName)} in ${organizationName}.`,
  },
  {
    id: "rtu.update",
    title: "Edit an RTU",
    method: "PATCH",
    path: "/admin/rtus/:id",
    params: { id: uuidParam },
    body: updateRtuBodySchema,
    bodyName: "updateRtuBodySchema",
    clientOnly: [],
    risk: "edit",
    target: RTU,
    refs: [],
    formulas: [],
    steps: [{ id: "basics", title: "Basics", fields: ["code", "displayName", "sourceType", "domain"] }, SOURCE, METADATA],
    summary: ({ body, targetName }) => `Change ${fieldList(body)} of the RTU ${quoted(targetName)}.`,
  },
  {
    id: "rtu.deactivate",
    title: "Deactivate an RTU",
    method: "POST",
    path: "/admin/rtus/:id/deactivate",
    params: { id: uuidParam },
    body: emptyBody,
    bodyName: null,
    clientOnly: [],
    risk: "deactivate",
    target: RTU,
    refs: [],
    formulas: [],
    steps: [],
    summary: ({ targetName }) => `Deactivate the RTU ${quoted(targetName)}.`,
  },
  {
    id: "rtu.reactivate",
    title: "Reactivate an RTU",
    method: "POST",
    path: "/admin/rtus/:id/reactivate",
    params: { id: uuidParam },
    body: emptyBody,
    bodyName: null,
    clientOnly: [],
    risk: "edit",
    target: RTU,
    refs: [],
    formulas: [],
    steps: [],
    summary: ({ targetName }) => `Reactivate the RTU ${quoted(targetName)}.`,
  },
];

/** The area's write routes that are not entries. All four are entries since PR 3a. */
export const RTU_PENDING: readonly ExcludedRoute[] = [];
