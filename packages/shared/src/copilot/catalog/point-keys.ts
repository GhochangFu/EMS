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

// `F4.309` PR 1 (ADR 0088 Amendment 3) lands the state-label routes before their catalog
// entries; PR 3 (ADR 0099 Amendment 13) moves them to `point-key-states.ts`: `POST` and `PATCH`
// become `pointKeyState.create` and `.update`, and the `DELETE` stays excluded for good.
const STATE_LABEL_ENTRY_NEXT =
  "F4.309 PR 1 lands the route; PR 3 adds the pointKeyState entry (ADR 0099 Amendment 13) and removes this row";
const STATE_LABEL_NO_DELETE =
  "a hard DELETE is never in the catalog (decision 3); ADR 0099 Amendment 13 decision 5 keeps it manual";

/** The area's write routes that are not entries: the point keys none since PR 3c; the state labels until `F4.309` PR 3. */
export const POINT_KEY_PENDING: readonly ExcludedRoute[] = [
  { method: "POST", path: "/admin/point-key-states", reason: STATE_LABEL_ENTRY_NEXT },
  { method: "PATCH", path: "/admin/point-key-states/:id", reason: STATE_LABEL_ENTRY_NEXT },
  { method: "DELETE", path: "/admin/point-key-states/:id", reason: STATE_LABEL_NO_DELETE },
];
