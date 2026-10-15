import { ConflictException } from "@nestjs/common";
import { expect } from "vitest";

import { MIMIC_LAYOUT_STALE_MESSAGE } from "@bms/shared";

import { calls, FakeLlmProvider, toolCall } from "../admin/onboarding/onboarding-agent-loop.spec";
import {
  type CopilotProposeServices,
  PROPOSE_LAYOUT_ROLES_MISSING,
  PROPOSE_LAYOUT_ROLES_MISSING_ADMIN,
} from "./copilot-propose-tools";
import { CHANGE_ID, harness, identity, ORG_X, sentText, turn } from "./copilot-turn.service.spec";

/**
 * `F3.87` PR 5 / owner ruling Q4 (2026-10-15) — the turn loop with
 * `FakeLlmProvider`: a layout naming a role the vocabulary lacks is refused
 * with the sentence for the caller's role, and no card is stored; a layout
 * whose roles are live stores one. One claim per `it()`. The
 * `assetRole.create` half (the role card, then the layout after its applied
 * follow-up) needs that entry, which PR 6 adds. Vitest entry point: the
 * sibling `.test.ts`.
 */

/** A layout body whose one unit names `roleCode`; two units and a pipe, on the core library. */
function layoutBody(roleCode: string): Record<string, unknown> {
  return {
    organizationId: ORG_X,
    name: "Raw water",
    slug: "raw-water",
    canvasW: 120,
    canvasH: 80,
    nodes: [
      { key: "pump_1", kind: "unit", symbol: "pump", label: "Pump 1", roleCode, x: 0, y: 0, w: 20, h: 25, isSource: true },
      { key: "tank_1", kind: "unit", symbol: "tank", label: "Tank 1", x: 40, y: 0, w: 20, h: 25 },
    ],
    pipes: [{ fromKey: "pump_1", toKey: "tank_1" }],
    symbolLibraries: ["core"],
  };
}

/** A fake layouts service over a live role vocabulary; `stale` refuses every replace as the route's 409 does. */
function layoutsOver(live: readonly string[], options: { stale?: boolean } = {}) {
  const asked: string[][] = [];
  const layouts = {
    missingRoleCodes: async (codes: readonly string[]) => {
      asked.push([...codes]);
      return [...new Set(codes)].filter((code) => !live.includes(code)).sort();
    },
    validateProposal: async (_jwt: unknown, input: { kind: "create" | "replace" }) => {
      if (options.stale && input.kind === "replace") throw new ConflictException(MIMIC_LAYOUT_STALE_MESSAGE);
      return { baseline: input.kind === "replace" ? { version: 1, nodes: [], pipes: [] } : null };
    },
  } as unknown as NonNullable<CopilotProposeServices["layouts"]>;
  return { layouts, asked };
}

/** (Q4-a) As `admin`: a layout naming `pump-x` is refused with the sentence that names it, and no card is stored. */
export async function assertAnAdminsLayoutWithAMissingRoleIsRefusedNamingIt(): Promise<void> {
  const llm = new FakeLlmProvider([
    calls(toolCall("propose_mimicLayout_create", { body: layoutBody("pump-x") })),
    { kind: "final", text: "The role pump-x is missing." },
  ]);
  const { layouts, asked } = layoutsOver(["raw-water-pump"]);
  const h = harness(llm, { layouts });
  await turn(h, "draw the raw water plant");
  expect(asked).toEqual([["pump-x"]]);
  expect(sentText(llm)).toContain(JSON.stringify(PROPOSE_LAYOUT_ROLES_MISSING_ADMIN(["pump-x"])).slice(1, -1));
  expect(h.proposed).toEqual([]);
}

/** (Q4-c) As `organization_admin`: the refusal is the sentence form, and no layout card with `pump-x` is stored. */
export async function assertAnOrgAdminsLayoutWithAMissingRoleGetsTheSentenceForm(): Promise<void> {
  const llm = new FakeLlmProvider([
    calls(toolCall("propose_mimicLayout_create", { body: layoutBody("pump-x") })),
    { kind: "final", text: "A global administrator can add the role pump-x." },
  ]);
  const { layouts } = layoutsOver(["raw-water-pump"]);
  const h = harness(llm, { layouts });
  await turn(h, "draw the raw water plant", identity("organization_admin", ORG_X));
  const sent = sentText(llm);
  expect(sent).toContain(JSON.stringify(PROPOSE_LAYOUT_ROLES_MISSING(["pump-x"])).slice(1, -1));
  expect(sent).not.toContain(JSON.stringify(PROPOSE_LAYOUT_ROLES_MISSING_ADMIN(["pump-x"])).slice(1, -1));
  expect(h.proposed).toEqual([]);
}

/** (Q4-b, the layout half) A layout whose roles are all live stores one card. */
export async function assertALayoutWithLiveRolesStoresACard(): Promise<void> {
  const llm = new FakeLlmProvider([
    calls(toolCall("propose_mimicLayout_create", { body: layoutBody("raw-water-pump") })),
    { kind: "final", text: "Confirm the card to create the layout." },
  ]);
  const { layouts } = layoutsOver(["raw-water-pump"]);
  const h = harness(llm, { layouts });
  await turn(h, "draw the raw water plant");
  expect(h.proposed.map((change) => change.catalogId)).toEqual(["mimicLayout.create"]);
  expect(h.proposed[0]?.summary).toBe('Create the layout "Raw water" in Org X: 2 units, 0 panels, 1 pipe.');
}

/** (Q4-d) A stale `version` is refused at propose time with the route's own sentence; no card is stored. */
export async function assertAStaleLayoutReplaceIsRefusedAtPropose(): Promise<void> {
  const { organizationId: _drop, ...graph } = layoutBody("raw-water-pump");
  const llm = new FakeLlmProvider([
    calls(toolCall("propose_mimicLayout_replace", { id: CHANGE_ID, body: { version: 1, ...graph } })),
    { kind: "final", text: "The layout changed; let me read it again." },
  ]);
  const { layouts } = layoutsOver(["raw-water-pump"], { stale: true });
  const h = harness(llm, { layouts, target: { organizationId: ORG_X, organizationName: "Org X", targetName: "Raw water" } });
  await turn(h, "move the tank");
  expect(sentText(llm)).toContain(MIMIC_LAYOUT_STALE_MESSAGE);
  expect(h.proposed).toEqual([]);
}
