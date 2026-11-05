import { expect } from "vitest";

import * as contracts from "../../contracts";
import { catalogEntry, COPILOT_CATALOG, DELETE_ALLOWANCE, EXCLUDED_ROUTES } from "./index";
import type { CatalogEntry } from "./types";

/**
 * `F4.309` PR 3 (ADR 0099 Amendment 13 decisions 1, 2 and 5; plan T13) — the two state-label
 * entries. The rules every entry obeys are `catalog.spec.ts`'s; this file holds what is particular
 * to these two: a `fleet` create, an edit on the new `pointKeyState` target, summaries that call
 * the label fleet-wide and never name the bound organization, and a `DELETE` that stays excluded.
 * Mutation, applied once and seen red: give `pointKeyState.update` the target
 * `{ kind: "pointKey", param: "id" }` ({@link theUpdateTargetsThePointKeyStateRow}).
 * Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

const COLLECTION = "/admin/point-key-states";
const ROW = "/admin/point-key-states/:id";
const ID = "22222222-2222-4222-8222-222222222222";

function entry(id: string): CatalogEntry {
  const found = catalogEntry(id);
  if (!found) throw new Error(`no catalog entry ${id}`);
  return found;
}

/** Decision 1: the create is the collection's `POST`, risk `create`, on a `fleet` target. */
export function theCreateIsAFleetPost(): void {
  const create = entry("pointKeyState.create");
  expect([create.method, create.path, create.risk, create.target, create.params]).toEqual(["POST", COLLECTION, "create", { kind: "fleet" }, {}]);
}

/** Decision 1: the edit is the row's `PATCH`, risk `edit`, its `id` a uuid path parameter. */
export function theUpdateIsAPatchOfTheRow(): void {
  const update = entry("pointKeyState.update");
  expect([update.method, update.path, update.risk]).toEqual(["PATCH", ROW, "edit"]);
  expect(update.params.id?.safeParse(ID).success).toBe(true);
  expect(update.params.id?.safeParse("breaker_main").success).toBe(false);
}

/** Decision 1: the new target kind `pointKeyState`, named by the path's `id`. */
export function theUpdateTargetsThePointKeyStateRow(): void {
  expect(entry("pointKeyState.update").target).toEqual({ kind: "pointKeyState", param: "id" });
}

/** The bodies are the routes' own exports, by identity (the service parses these very schemas). */
export function theBodiesAreTheRoutesOwnSchemas(): void {
  expect(entry("pointKeyState.create").body).toBe(contracts.createPointKeyStateBodySchema);
  expect(entry("pointKeyState.create").bodyName).toBe("createPointKeyStateBodySchema");
  expect(entry("pointKeyState.update").body).toBe(contracts.updatePointKeyStateBodySchema);
  expect(entry("pointKeyState.update").bodyName).toBe("updatePointKeyStateBodySchema");
}

/** The routes are the global admin's alone (`requireGlobalAdmin`), so the entries are offered to `admin` only. */
export function bothAreOfferedToTheGlobalAdminAlone(): void {
  for (const id of ["pointKeyState.create", "pointKeyState.update"]) {
    const found = entry(id);
    expect({ offeredTo: found.offeredTo, clientOnly: found.clientOnly, precondition: found.precondition }, id).toEqual({
      offeredTo: ["admin"],
      clientOnly: [],
      precondition: undefined,
    });
  }
}

/** Decision 4 (ADR 0088 Amendment 3): an edit changes the label and the tone only, so its step never offers the key or value. */
export function theStepsNameTheWritableFields(): void {
  expect(entry("pointKeyState.create").steps.flatMap((step) => step.fields)).toEqual(["pointKey", "value", "label", "tone"]);
  expect(entry("pointKeyState.update").steps.flatMap((step) => step.fields)).toEqual(["label", "tone"]);
}

/** Decision 2: each summary says fleet-wide and never names the bound organization (a `fleet` create's `targetName`). */
export function theSummariesSayFleetWideAndNeverTheOrganization(): void {
  const create = entry("pointKeyState.create").summary({
    body: { pointKey: "isolator_pos", value: 2.5, label: "EARTHED", tone: "open" },
    params: {},
    targetName: "Org Seven",
    organizationName: "Org Seven",
  });
  expect(create).toContain("fleet-wide");
  expect(create).toContain("isolator_pos = 2.5");
  expect(create).toContain('"EARTHED"');
  expect(create).toContain("open");
  expect(create).not.toContain("Org Seven");
  const update = entry("pointKeyState.update").summary({
    body: { label: "EARTH", tone: "shut" },
    params: { id: ID },
    targetName: "isolator_pos = 2.5 (EARTHED)",
    organizationName: "Org Seven",
  });
  expect(update).toContain("fleet-wide");
  expect(update).toContain("isolator_pos = 2.5 (EARTHED)");
  expect(update).toContain('label to "EARTH"');
  expect(update).toContain("tone to shut");
  expect(update).not.toContain("Org Seven");
}

/** An edit naming one field says only that field. */
export function anUpdateSummaryNamesOnlyTheFieldsSent(): void {
  const update = entry("pointKeyState.update").summary({
    body: { tone: "tripped" },
    params: { id: ID },
    targetName: "isolator_pos = 2.5 (EARTHED)",
    organizationName: "",
  });
  expect(update).toContain("tone to tripped");
  expect(update).not.toContain("label to");
}

/** Decision 5: the `DELETE` is excluded, never an entry, and `DELETE_ALLOWANCE` does not name it. */
export function theDeleteStaysExcluded(): void {
  const excluded = EXCLUDED_ROUTES.filter((route) => route.path.startsWith(COLLECTION));
  expect(excluded.map((route) => `${route.method} ${route.path}`)).toEqual([`DELETE ${ROW}`]);
  expect(COPILOT_CATALOG.filter((candidate) => candidate.path === ROW && candidate.method === "DELETE")).toEqual([]);
  expect(DELETE_ALLOWANCE.some((route) => route.path === ROW)).toBe(false);
}

/** PR 3 takes the `POST` and the `PATCH` off the pending list: they are entries now. */
export function theWritesAreNoLongerPending(): void {
  const keys = EXCLUDED_ROUTES.map((route) => `${route.method} ${route.path}`);
  expect(keys).not.toContain(`POST ${COLLECTION}`);
  expect(keys).not.toContain(`PATCH ${ROW}`);
  expect(COPILOT_CATALOG.filter((candidate) => candidate.path.startsWith(COLLECTION)).map((candidate) => candidate.id)).toEqual([
    "pointKeyState.create",
    "pointKeyState.update",
  ]);
}
