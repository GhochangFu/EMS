import { expect } from "vitest";

import type { AdminPointKeyStateDto, JwtPayload } from "@bms/shared";

import type { ResolvedIdentity } from "../../auth/identity-resolver";
import type { CopilotToolContext } from "../copilot-read-tools";
import { COPILOT_TOOL_RESULT_BUDGET_CHARS, type CopilotReadServices } from "./copilot-read-tool";
import { createCopilotReadTools } from "./copilot-read-tool-set";
import { COPILOT_POINT_KEY_STATES_ROLE_REFUSAL, POINT_KEY_STATES_TOOL_MAX_ITEMS } from "./list-point-key-states.tool";

/**
 * `F4.309` PR 3 (ADR 0099 Amendment 13 decision 3, ruling Q1; plan T15) — `list_point_key_states`
 * over a fake `PointKeyStatesAdminService.list` that logs its calls: the admin list's own read
 * (its `requireGlobalAdmin` is the second line), refused before the call for anyone but the global
 * admin, each row id, key, value, label, tone and `seeded`, by key then value. The real read on
 * `bms_fleet` is the integration spec's (`copilot-point-key-state-targets.integration.spec.ts`).
 * Mutation, applied once and seen red: drop the role check ({@link aTenantAdministratorIsRefusedBeforeTheRead}).
 * Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

const USER = "11111111-1111-4111-8111-111111111111";
const ORG_X = "00000000-0000-4000-8000-0000000000aa";

function row(id: number, pointKey: string, value: number, seeded = false): AdminPointKeyStateDto {
  return { id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(id).padStart(12, "0")}`, pointKey, value, label: `L${id}`, tone: "open", seeded };
}

function ctx(role: string, organizationId: string | null): CopilotToolContext {
  return {
    identity: { id: USER, role, organizationId } as ResolvedIdentity,
    user: { sub: USER, role } as JwtPayload,
    conversationId: "22222222-2222-4222-8222-222222222222",
    conversationOrganizationId: ORG_X,
    allowedOrganizationIds: [ORG_X],
    turnKind: "user",
    now: new Date("2026-11-05T06:00:00Z"),
  };
}

function fake(items: unknown[]) {
  const calls: JwtPayload[] = [];
  const services = {
    pointKeyStates: {
      list: async (user: JwtPayload) => {
        calls.push(user);
        return { items };
      },
    },
  } as unknown as CopilotReadServices;
  return { tools: createCopilotReadTools(services), calls };
}

const ADMIN = ctx("admin", null);

/** Every row, id, key, value, label, tone and `seeded` only, by key then value; a fleet vocabulary names no organization. */
export async function listsEveryRowByKeyThenValue(): Promise<void> {
  const { tools, calls } = fake([row(3, "valve_open", 1, true), row(1, "breaker_main", 1, true), row(2, "breaker_main", 0.5)]);
  const out = await tools.dispatch("list_point_key_states", {}, ADMIN);
  expect(out).toEqual({
    ok: true,
    result: {
      items: [
        { id: row(2, "", 0).id, pointKey: "breaker_main", value: 0.5, label: "L2", tone: "open", seeded: false },
        { id: row(1, "", 0).id, pointKey: "breaker_main", value: 1, label: "L1", tone: "open", seeded: true },
        { id: row(3, "", 0).id, pointKey: "valve_open", value: 1, label: "L3", tone: "open", seeded: true },
      ],
      truncated: false,
    },
    organizationIds: [],
  });
  // The admin list's own read, once, with the caller's token (its gate is the second line).
  expect(calls).toEqual([ADMIN.user]);
}

/** Ruling Q1: the global admin's conversation only — a tenant administrator is refused, and nothing is read. */
export async function aTenantAdministratorIsRefusedBeforeTheRead(): Promise<void> {
  for (const role of ["organization_admin", "location_admin", "asset_group_admin"]) {
    const { tools, calls } = fake([row(1, "breaker_main", 1, true)]);
    expect(await tools.dispatch("list_point_key_states", {}, ctx(role, ORG_X)), role).toEqual({
      ok: false,
      error: COPILOT_POINT_KEY_STATES_ROLE_REFUSAL,
    });
    expect(calls, role).toEqual([]);
  }
}

/** `pointKey` narrows to one key's rows before the cap. */
export async function aPointKeyNarrowsTheList(): Promise<void> {
  const { tools } = fake([row(1, "breaker_main", 1, true), row(2, "isolator_pos", 2)]);
  const out = await tools.dispatch("list_point_key_states", { pointKey: "isolator_pos" }, ADMIN);
  expect(out.ok && (out.result.items as { pointKey: string }[]).map((item) => item.pointKey)).toEqual(["isolator_pos"]);
}

/** More rows than the cap: the first ones by key then value, and `truncated` says there are more. */
export async function theListIsCutAtTheCap(): Promise<void> {
  const many = Array.from({ length: POINT_KEY_STATES_TOOL_MAX_ITEMS + 3 }, (_, i) => row(i + 1, "isolator_pos", i));
  const { tools } = fake(many);
  const out = await tools.dispatch("list_point_key_states", {}, ADMIN);
  if (!out.ok) throw new Error(out.error);
  expect((out.result.items as unknown[]).length).toBe(POINT_KEY_STATES_TOOL_MAX_ITEMS);
  expect(out.result.truncated).toBe(true);
  // The cap keeps the longest rows the contract allows inside the result budget (a 128-character key, a 32-character label).
  const longest = Array.from({ length: POINT_KEY_STATES_TOOL_MAX_ITEMS + 1 }, (_, i) => ({
    ...row(i + 1, "k".repeat(128), -1.2345678901234567e-300 * (i + 1)),
    label: "L".repeat(32),
    tone: "flowing",
  }));
  const big = await fake(longest).tools.dispatch("list_point_key_states", {}, ADMIN);
  expect(JSON.stringify(big).length).toBeLessThan(COPILOT_TOOL_RESULT_BUDGET_CHARS);
}

/** The service's rows go through the guarded parse: a row off its contract is a refusal, never a pass-through. */
export async function theServicesRowsAreParsed(): Promise<void> {
  await expect(fake([{ id: 7, pointKey: "x" }]).tools.dispatch("list_point_key_states", {}, ADMIN)).rejects.toThrow();
}

/** The tool takes only an optional `pointKey` (strict): an organization id is refused by the schema. */
export function theToolTakesOnlyAPointKey(): void {
  const definition = fake([]).tools.registry.definitions.find((d) => d.name === "list_point_key_states");
  expect(definition?.parameters).toMatchObject({ type: "object", additionalProperties: false });
  expect(Object.keys((definition?.parameters as { properties: Record<string, unknown> }).properties)).toEqual(["pointKey"]);
}

/** The description tells the model a seeded row is read-only, so it proposes an edit of a non-seeded row only. */
export function theDescriptionSaysASeededRowIsReadOnly(): void {
  const definition = fake([]).tools.registry.definitions.find((d) => d.name === "list_point_key_states");
  expect(definition?.description).toContain("seeded");
  expect(definition?.description).toContain("read-only");
  expect(definition?.description).toContain("pointKeyState.update");
}
