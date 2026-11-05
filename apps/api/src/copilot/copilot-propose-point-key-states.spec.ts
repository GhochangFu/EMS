import { expect } from "vitest";

import { proposeToolName } from "@bms/shared/copilot";

import type { ResolvedIdentity } from "../auth/identity-resolver";
import { seededPointKeyStateMessage } from "./copilot-point-key-state-targets";
import { PROPOSE_FLEET_UNBOUND_ERROR, PROPOSE_ROLE_ERROR } from "./copilot-propose-tools";
import { proposeHarness } from "./copilot-propose-tools.spec";
import { CopilotTargetRefusal } from "./copilot-telemetry-targets";

/**
 * `F4.309` PR 3 (ADR 0099 Amendment 13; plan T13, T14) — the two state-label propose tools over
 * the real catalog entries: the global admin's alone, a bound conversation only, the seeded
 * refusal's sentence reaching the model with no card stored, and a card that says fleet-wide.
 * The resolver itself is `copilot-target-resolver.point-key-states.spec.ts`'s.
 * Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

const ORG_X = "00000000-0000-4000-8000-0000000000aa";
const USER = "11111111-1111-4111-8111-111111111111";
const ROW = "22222222-2222-4222-8222-222222222222";

const CREATE = proposeToolName({ id: "pointKeyState.create" });
const UPDATE = proposeToolName({ id: "pointKeyState.update" });
const TOOLS = [CREATE, UPDATE];

const ARGS: Readonly<Record<string, Record<string, unknown>>> = {
  [CREATE]: { body: { pointKey: "isolator_pos", value: 2.5, label: "EARTHED", tone: "open" } },
  [UPDATE]: { id: ROW, body: { label: "EARTH", tone: "shut" } },
};

/** The three tenant administrators the routes refuse (`requireGlobalAdmin`). */
export const REFUSED_ROLES = ["organization_admin", "location_admin", "asset_group_admin"] as const;

/** The global admin's registry names both tools. */
export function bothToolsAreInTheGlobalAdminsRegistry(): void {
  const names = proposeHarness().tools.registryFor({ access: true, role: "admin" }).definitions.map((d) => d.name);
  for (const tool of TOOLS) expect(names, tool).toContain(tool);
}

/** Another role's registry names neither, and a direct call is refused before the resolver. */
export async function bothToolsAreRefusedTo(role: (typeof REFUSED_ROLES)[number]): Promise<void> {
  const h = proposeHarness();
  const names = h.tools.registryFor({ access: true, role }).definitions.map((d) => d.name);
  expect(names.filter((name) => TOOLS.includes(name))).toEqual([]);
  const identity = { id: USER, role, organizationId: ORG_X } as ResolvedIdentity;
  for (const tool of TOOLS) {
    expect(await h.tools.dispatch(tool, ARGS[tool] as Record<string, unknown>, h.ctx({ identity })), tool).toEqual({
      ok: false,
      error: PROPOSE_ROLE_ERROR,
    });
  }
  expect([h.resolved, h.stored]).toEqual([[], []]);
}

/** `F3.86` ruling Q1: a state-label change in an unbound conversation is refused before the resolver is asked. */
export async function aStateLabelChangeNeedsABoundConversation(): Promise<void> {
  const h = proposeHarness();
  for (const tool of TOOLS) {
    const result = await h.tools.dispatch(tool, ARGS[tool] as Record<string, unknown>, h.ctx({ conversationOrganizationId: null }));
    expect(result, tool).toEqual({ ok: false, error: PROPOSE_FLEET_UNBOUND_ERROR });
  }
  expect(h.resolved).toEqual([]);
}

/** Ruling Q2: the resolver's seeded refusal reaches the model as its sentence, and no card is stored. */
export async function theSeededRefusalReachesTheModelAndStoresNoCard(): Promise<void> {
  const sentence = seededPointKeyStateMessage("breaker_main", 1);
  const h = proposeHarness({ resolveThrows: new CopilotTargetRefusal(sentence) });
  const refused = await h.call(UPDATE, ARGS[UPDATE]);
  expect([refused.ok, refused.content]).toEqual([false, sentence]);
  expect(sentence).toContain("seeded and read-only");
  expect(h.stored).toEqual([]);
}

/** A create stores the collection's POST, its body as sent, and a card that says fleet-wide. */
export async function aCreateStoresAFleetWideCard(): Promise<void> {
  const h = proposeHarness({ target: { organizationId: ORG_X, organizationName: "Org X", targetName: "Org X" } });
  expect((await h.call(CREATE, ARGS[CREATE])).ok).toBe(true);
  const stored = h.stored[0];
  expect([stored?.method, stored?.path, stored?.risk]).toEqual(["POST", "/api/v1/admin/point-key-states", "create"]);
  expect(stored?.body).toEqual(ARGS[CREATE]?.body);
  expect(stored?.summary).toContain("fleet-wide");
  expect(stored?.summary).not.toContain("Org X");
}

/** An edit stores the row's PATCH, and its card names the row as the resolver did. */
export async function anEditStoresTheRowsPatch(): Promise<void> {
  const h = proposeHarness({ target: { organizationId: ORG_X, organizationName: "Org X", targetName: "isolator_pos = 2.5 (EARTHED)" } });
  expect((await h.call(UPDATE, ARGS[UPDATE])).ok).toBe(true);
  const stored = h.stored[0];
  expect([stored?.method, stored?.path, stored?.risk]).toEqual(["PATCH", `/api/v1/admin/point-key-states/${ROW}`, "edit"]);
  expect(stored?.summary).toContain("isolator_pos = 2.5 (EARTHED)");
  expect(h.resolved[0]?.params).toEqual({ id: ROW });
}

/** Decision 4: an edit naming the key or the value is refused by the strict body; nothing is stored. */
export async function anEditOfTheKeyOrValueIsRefused(): Promise<void> {
  const h = proposeHarness();
  for (const body of [{ pointKey: "breaker_main" }, { value: 3 }]) {
    const refused = await h.call(UPDATE, { id: ROW, body });
    expect(refused.ok).toBe(false);
    expect(refused.content).toContain("Invalid body");
  }
  expect(h.stored).toEqual([]);
}
