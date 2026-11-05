import { createPointKeyStateBodySchema, updatePointKeyStateBodySchema } from "../../contracts/point-key-state-writes";
import { quoted, text, uuidParam } from "./summary-text";
import type { CatalogEntry, ExcludedRoute } from "./types";

/**
 * `F4.309` PR 3 (ADR 0099 Amendment 13; ADR 0088 Amendment 3) — the state-label catalog: which
 * value of a switching point key reads as which label and tone (`bms.point_key_states`).
 *
 * The table has no organization, so the create is a `fleet` target and the edit a
 * `pointKeyState` row named by its `id`: the change lives in the conversation's bound
 * organization, and a conversation bound to none is refused at propose time (ruling Q1 of
 * `F3.86`). The routes are the global admin's alone (`requireGlobalAdmin`), so both entries are
 * offered to `admin` only; the resolver's fleet gate and the service stay the second and third
 * lines. A seeded row (`POINT_KEY_STATE_SEED`) is refused at propose by the resolver and at apply
 * by the route's 409 (Amendment 13 ruling Q2). No `precondition`: the table has no `updated_at`.
 *
 * Decision 2: the summaries call the label fleet-wide; they never say it belongs to the bound
 * organization (a `fleet` create's `targetName` is that organization's name, so the create's
 * summary reads the body only).
 */

/** A body number as a card shows it; anything else as the empty string (the strict body refuses it first). */
function numberText(body: Readonly<Record<string, unknown>>, key: string): string {
  const value = body[key];
  return typeof value === "number" ? String(value) : "";
}

/** The fields an edit sends, as "label to "X" and tone to shut", in the order sent. */
function stateChanges(body: Readonly<Record<string, unknown>>): string {
  const parts = Object.keys(body).map((key) => (key === "label" ? `label to ${quoted(text(body, "label"))}` : `${key} to ${text(body, key)}`));
  if (parts.length === 0) return "nothing";
  return parts.length === 1 ? (parts[0] as string) : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export const POINT_KEY_STATE_ENTRIES: readonly CatalogEntry[] = [
  {
    id: "pointKeyState.create",
    title: "Add a state label",
    method: "POST",
    path: "/admin/point-key-states",
    params: {},
    body: createPointKeyStateBodySchema,
    bodyName: "createPointKeyStateBodySchema",
    clientOnly: [],
    offeredTo: ["admin"],
    risk: "create",
    target: { kind: "fleet" },
    refs: [],
    formulas: [],
    steps: [{ id: "state", title: "State", fields: ["pointKey", "value", "label", "tone"] }],
    summary: ({ body }) =>
      `Add the fleet-wide state label ${quoted(text(body, "label"))} (tone ${text(body, "tone")}) for ` +
      `${text(body, "pointKey")} = ${numberText(body, "value")}: every mimic and the state legend show it for that value.`,
  },
  {
    id: "pointKeyState.update",
    title: "Edit a state label",
    method: "PATCH",
    path: "/admin/point-key-states/:id",
    params: { id: uuidParam },
    body: updatePointKeyStateBodySchema,
    bodyName: "updatePointKeyStateBodySchema",
    clientOnly: [],
    offeredTo: ["admin"],
    risk: "edit",
    target: { kind: "pointKeyState", param: "id" },
    refs: [],
    formulas: [],
    // Decision 4 (ADR 0088 Amendment 3): the key and the value never change on an edit.
    steps: [{ id: "state", title: "State", fields: ["label", "tone"] }],
    summary: ({ body, targetName }) => `Change the fleet-wide state label ${targetName}: ${stateChanges(body)}.`,
  },
];

/** Decision 5: the hard `DELETE` stays manual for good; `DELETE_ALLOWANCE` does not change. */
export const POINT_KEY_STATE_PENDING: readonly ExcludedRoute[] = [
  {
    method: "DELETE",
    path: "/admin/point-key-states/:id",
    reason: "a hard DELETE is never in the catalog (decision 3); ADR 0099 Amendment 13 decision 5 keeps it manual",
  },
];
