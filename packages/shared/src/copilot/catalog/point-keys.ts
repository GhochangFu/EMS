import { createPointKeyBodySchema, updatePointKeyBodySchema } from "../../contracts/point-key-writes";
import { emptyBody, fieldList, quoted, text, uuidParam } from "./summary-text";
import type { CatalogEntry, CatalogTarget, ExcludedRoute } from "./types";

/**
 * `F3.86` PR 3c (ADR 0099 release 2, ruling Q1) — the point-key catalog.
 *
 * A point key has no organization (`bms.point_keys` is fleet-wide since
 * migration `0057`), so a create is a `fleet` target and every other write a
 * `pointKey` row: the change lives in the conversation's bound organization,
 * and a conversation bound to none is refused at propose time. The routes'
 * own check is the global administrator's (`point-keys.service.ts`
 * `requireGlobalAdmin`), which the resolver calls.
 *
 * The summaries name the code and call the catalog fleet-wide; they never
 * say the key belongs to the bound organization (a `fleet` create's
 * `targetName` is that organization's name, not the key's).
 */
const POINT_KEY: CatalogTarget = { kind: "pointKey", param: "id" };

export const POINT_KEY_ENTRIES: readonly CatalogEntry[] = [
  {
    id: "pointKey.create",
    title: "Add a point key",
    method: "POST",
    path: "/admin/point-keys",
    params: {},
    body: createPointKeyBodySchema,
    bodyName: "createPointKeyBodySchema",
    clientOnly: [],
    risk: "create",
    target: { kind: "fleet" },
    refs: [],
    formulas: [],
    steps: [
      { id: "basics", title: "Basics", fields: ["code", "name", "domain", "unit"] },
      { id: "details", title: "Details", fields: ["description", "headlineRank", "trendDefault"] },
    ],
    summary: ({ body }) =>
      `Add the point key ${quoted(text(body, "code"))} (${text(body, "name")}) to the fleet-wide point-key catalog.`,
  },
  {
    id: "pointKey.update",
    title: "Edit a point key",
    method: "PATCH",
    path: "/admin/point-keys/:id",
    params: { id: uuidParam },
    body: updatePointKeyBodySchema,
    bodyName: "updatePointKeyBodySchema",
    clientOnly: [],
    risk: "edit",
    target: POINT_KEY,
    refs: [],
    formulas: [],
    steps: [
      { id: "basics", title: "Basics", fields: ["name", "domain", "unit"] },
      { id: "details", title: "Details", fields: ["description", "headlineRank", "trendDefault"] },
    ],
    summary: ({ body, targetName }) => `Change ${fieldList(body)} of the fleet-wide point key ${quoted(targetName)}.`,
  },
  {
    id: "pointKey.deactivate",
    title: "Deactivate a point key",
    method: "POST",
    path: "/admin/point-keys/:id/deactivate",
    params: { id: uuidParam },
    body: emptyBody,
    bodyName: null,
    clientOnly: [],
    risk: "deactivate",
    target: POINT_KEY,
    refs: [],
    formulas: [],
    steps: [],
    summary: ({ targetName }) => `Deactivate the fleet-wide point key ${quoted(targetName)}.`,
  },
  {
    id: "pointKey.reactivate",
    title: "Reactivate a point key",
    method: "POST",
    path: "/admin/point-keys/:id/reactivate",
    params: { id: uuidParam },
    body: emptyBody,
    bodyName: null,
    clientOnly: [],
    risk: "edit",
    target: POINT_KEY,
    refs: [],
    formulas: [],
    steps: [],
    summary: ({ targetName }) => `Reactivate the fleet-wide point key ${quoted(targetName)}.`,
  },
];

/** The area's write routes that are not entries: none since PR 3c. */
export const POINT_KEY_PENDING: readonly ExcludedRoute[] = [];
