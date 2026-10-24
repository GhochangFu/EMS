import { expect } from "vitest";

import type { ResolvedIdentity } from "../auth/identity-resolver";
import { proposeHarness } from "./copilot-propose-tools.spec";

/**
 * `F4.281` (ADR 0099 Amendment 8, D3, D6, Q15; owner ruling DC1) — the propose
 * tools over the real maintenance-schedule entries: every copilot role's, the
 * direction fixed in each model body with an optional reason, and no
 * precondition. Vitest entry point: the sibling `.test.ts`.
 */

const ORG_X = "00000000-0000-4000-8000-0000000000aa";
const USER = "11111111-1111-4111-8111-111111111111";
const SCHEDULE = "40000000-0000-4000-8000-000000000001";
const ASSET = "30000000-0000-4000-8000-0000000000aa";

const TARGET = { organizationId: ORG_X, organizationName: "Org X", targetName: "Quarterly filter check" };

export const MAINTENANCE_TOOLS = [
  "propose_maintenanceSchedule_create",
  "propose_maintenanceSchedule_activate",
  "propose_maintenanceSchedule_deactivate",
];

/** D3: the deactivate stores `{ active: false }` with its reason, red, on the schedule's path, with no precondition (D6). */
export async function theDeactivateStoresItsBody(): Promise<void> {
  const h = proposeHarness({ target: TARGET });
  const outcome = await h.call("propose_maintenanceSchedule_deactivate", { id: SCHEDULE, body: { active: false, reason: "Season over" } });
  expect(outcome.ok, outcome.content).toBe(true);
  expect(h.stored[0]).toMatchObject({
    body: { active: false, reason: "Season over" },
    risk: "deactivate",
    path: `/api/v1/maintenance/schedules/${SCHEDULE}`,
    precondition: null,
  });
}

/** Owner ruling DC1: the deactivate tool refuses `active: true` — the direction is the entry's. */
export async function theDeactivateRefusesTheOtherDirection(): Promise<void> {
  const h = proposeHarness({ target: TARGET });
  expect((await h.call("propose_maintenanceSchedule_deactivate", { id: SCHEDULE, body: { active: true } })).ok).toBe(false);
  expect(h.stored).toEqual([]);
}

/** The activate stores `{ active: true }` as an edit. */
export async function theActivateStoresActiveTrue(): Promise<void> {
  const h = proposeHarness({ target: TARGET });
  expect((await h.call("propose_maintenanceSchedule_activate", { id: SCHEDULE, body: { active: true } })).ok).toBe(true);
  expect(h.stored[0]).toMatchObject({ body: { active: true }, risk: "edit" });
}

/** The create stores the raw body and a summary naming the asset and the organization. */
export async function theCreateStoresTheRawBody(): Promise<void> {
  const h = proposeHarness({ target: { organizationId: ORG_X, organizationName: "Org X", targetName: "Chiller 2" } });
  const body = { assetId: ASSET, title: "Quarterly filter check", intervalDays: 90, firstDueAt: "2026-11-01T09:00:00.000Z" };
  expect((await h.call("propose_maintenanceSchedule_create", { body })).ok).toBe(true);
  expect(h.stored[0]?.body).toEqual(body);
  expect(h.stored[0]?.summary).toContain("on Chiller 2 in Org X");
}

/** Q15: the three tools are in an asset_group_admin's registry, and a dispatch by one is admitted. */
export async function theToolsAreOfferedToAnAssetGroupAdmin(): Promise<void> {
  const h = proposeHarness({ target: TARGET });
  const names = h.tools.registryFor({ access: true, role: "asset_group_admin" }).definitions.map((d) => d.name);
  for (const tool of MAINTENANCE_TOOLS) expect(names, tool).toContain(tool);
  const identity = { id: USER, role: "asset_group_admin", organizationId: ORG_X } as ResolvedIdentity;
  const result = await h.tools.dispatch("propose_maintenanceSchedule_activate", { id: SCHEDULE, body: { active: true } }, h.ctx({ identity }));
  expect(result.ok).toBe(true);
}
