import { BadRequestException, ConflictException } from "@nestjs/common";
import { expect } from "vitest";

import { MIMIC_LAYOUT_STALE_MESSAGE } from "@bms/shared";
import { type CatalogEntry, catalogEntry } from "@bms/shared/copilot";

import type { ResolvedIdentity } from "../auth/identity-resolver";
import { UNKNOWN_ROLE_MESSAGE } from "../mimic-layouts/mimic-layouts.service";
import { bodyHash } from "./body-hash";
import {
  type CopilotProposeServices,
  PROPOSE_LAYOUT_ROLES_MISSING,
  PROPOSE_LAYOUT_ROLES_MISSING_ADMIN,
  PROPOSE_LAYOUT_UNAVAILABLE_ERROR,
} from "./copilot-propose-tools";
import { proposeHarness } from "./copilot-propose-tools.spec";

/**
 * `F3.87` PR 5 (ADR 0099 Amendment 3 A2, owner rulings Q4 and Q5) — the two
 * layout entries' propose path over the real catalog entries, a fake
 * resolver, a fake pending store and a fake `MimicLayoutsService`. Vitest
 * entry point: the sibling `.test.ts`.
 */

const ORG_X = "00000000-0000-4000-8000-0000000000aa";
const USER = "11111111-1111-4111-8111-111111111111";

const LAYOUT_ID = "55555555-5555-4555-8555-555555555555";
const LAYOUT_GRAPH = {
  name: "Raw water",
  slug: "raw-water",
  canvasW: 120,
  canvasH: 80,
  nodes: [
    { key: "pump_1", kind: "unit", symbol: "pump", label: "Pump 1", roleCode: "raw-water-pump", x: 0, y: 0, w: 20, h: 25, isSource: true },
    { key: "tank_1", kind: "unit", symbol: "tank", label: "Tank 1", x: 40, y: 0, w: 20, h: 25 },
  ],
  pipes: [{ fromKey: "pump_1", toKey: "tank_1" }],
  symbolLibraries: ["core"],
};
const CREATE_LAYOUT = { organizationId: ORG_X, ...LAYOUT_GRAPH };
const REPLACE_LAYOUT = { version: 3, ...LAYOUT_GRAPH };
const BASELINE = {
  version: 3,
  nodes: [
    {
      key: "pump_1",
      kind: "unit",
      symbol: "pump",
      label: "Pump 1",
      roleCode: "raw-water-pump",
      tone: null,
      x: 0,
      y: 0,
      w: 20,
      h: 25,
      z: 10,
      fanOut: false,
      isSource: true,
      isSwitching: false,
    },
  ],
  pipes: [],
};
const layoutCatalog = (): CatalogEntry[] => [catalogEntry("mimicLayout.create")!, catalogEntry("mimicLayout.replace")!];
/**
 * The layout entries plus a stand-in `assetRole.create` (its real entry lands in `F3.87` PR 6): the
 * admin form of the role refusal is given only when the registry has that propose tool.
 */
const layoutCatalogWithRoleTool = (): CatalogEntry[] => [
  ...layoutCatalog(),
  { ...catalogEntry("mimicLayout.create")!, id: "assetRole.create" } as CatalogEntry,
];

/** A fake `MimicLayoutsService`: what `missingRoleCodes` answers, what `validateProposal` throws, and each call. */
function fakeLayouts(over: { missing?: string[]; refuse?: Error; baseline?: unknown } = {}) {
  const calls = { missing: [] as string[][], validated: [] as Array<{ kind: string; id?: string }> };
  const layouts = {
    missingRoleCodes: async (codes: readonly string[]) => {
      calls.missing.push([...codes]);
      return over.missing ?? [];
    },
    validateProposal: async (_jwt: unknown, input: { kind: "create" | "replace"; id?: string }) => {
      calls.validated.push({ kind: input.kind, ...(input.id !== undefined ? { id: input.id } : {}) });
      if (over.refuse) throw over.refuse;
      return { baseline: input.kind === "replace" ? (over.baseline ?? BASELINE) : null };
    },
  } as unknown as NonNullable<CopilotProposeServices["layouts"]>;
  return { layouts, calls };
}

/** A layout proposal runs `validateProposal`; its refusal (a dead library) is the tool result, and nothing is stored. */
export async function aLayoutOnADeadLibraryIsRefusedWithTheServicesSentence(): Promise<void> {
  const { layouts, calls } = fakeLayouts({ refuse: new BadRequestException("Unknown symbol library") });
  const h = proposeHarness({ catalog: layoutCatalog(), layouts });
  const outcome = await h.call("propose_mimicLayout_create", { body: CREATE_LAYOUT });
  expect(outcome).toMatchObject({ ok: false, error: "Unknown symbol library" });
  expect(calls.validated).toEqual([{ kind: "create" }]);
  expect(h.stored).toEqual([]);
}

/** A stale replace is refused at propose time with the route's own 409 sentence (ruling Q5). */
export async function aStaleReplaceIsRefusedAtPropose(): Promise<void> {
  const { layouts, calls } = fakeLayouts({ refuse: new ConflictException(MIMIC_LAYOUT_STALE_MESSAGE) });
  const h = proposeHarness({ catalog: layoutCatalog(), layouts });
  const outcome = await h.call("propose_mimicLayout_replace", { id: LAYOUT_ID, body: REPLACE_LAYOUT });
  expect(outcome).toMatchObject({ ok: false, error: MIMIC_LAYOUT_STALE_MESSAGE });
  expect(calls.validated).toEqual([{ kind: "replace", id: LAYOUT_ID }]);
  expect(h.stored).toEqual([]);
}

/** The stored replace body carries the baseline `validateProposal` returned. */
export async function aStoredReplaceCarriesItsBaseline(): Promise<void> {
  const { layouts } = fakeLayouts();
  const h = proposeHarness({ catalog: layoutCatalog(), layouts });
  expect((await h.call("propose_mimicLayout_replace", { id: LAYOUT_ID, body: REPLACE_LAYOUT })).ok).toBe(true);
  expect(h.stored[0]?.body).toEqual({ ...REPLACE_LAYOUT, baseline: BASELINE });
  expect(h.stored[0]?.path).toBe(`/api/v1/mimic-layouts/${LAYOUT_ID}`);
}

/** The stored hash leaves the baseline out: it is the hash of the body the browser sends without it. */
export async function aStoredReplaceHashLeavesOutTheBaseline(): Promise<void> {
  const { layouts } = fakeLayouts();
  const h = proposeHarness({ catalog: layoutCatalog(), layouts });
  expect((await h.call("propose_mimicLayout_replace", { id: LAYOUT_ID, body: REPLACE_LAYOUT })).ok).toBe(true);
  expect(h.stored[0]?.bodyHash).toBe(bodyHash(REPLACE_LAYOUT, []));
}

/** A create stores the body as the model sent it: no baseline key. */
export async function aStoredCreateHasNoBaseline(): Promise<void> {
  const { layouts } = fakeLayouts();
  const h = proposeHarness({ catalog: layoutCatalog(), layouts });
  expect((await h.call("propose_mimicLayout_create", { body: CREATE_LAYOUT })).ok).toBe(true);
  expect(h.stored[0]?.body).toEqual(CREATE_LAYOUT);
  expect(h.stored[0]?.summary).toBe('Create the layout "Raw water" in Org X: 2 units, 0 panels, 1 pipe.');
}

/** Ruling Q4: a global admin's create naming a missing role is told to propose the role first; the service is not asked. */
export async function anAdminsLayoutWithAMissingRoleIsToldToProposeTheRoleFirst(): Promise<void> {
  const { layouts, calls } = fakeLayouts({ missing: ["raw-water-pump"] });
  const h = proposeHarness({ catalog: layoutCatalogWithRoleTool(), layouts });
  const outcome = await h.call("propose_mimicLayout_create", { body: CREATE_LAYOUT });
  expect(outcome).toMatchObject({ ok: false, error: PROPOSE_LAYOUT_ROLES_MISSING_ADMIN(["raw-water-pump"]) });
  expect(outcome.error).toContain("assetRole.create");
  expect(calls.missing).toEqual([["raw-water-pump"]]);
  expect(calls.validated).toEqual([]);
  expect(h.stored).toEqual([]);
}

/** A global admin whose registry has no `propose_assetRole_create` gets the sentence form: no tool it cannot call. */
export async function anAdminWithoutTheRoleToolGetsTheSentenceForm(): Promise<void> {
  const { layouts } = fakeLayouts({ missing: ["raw-water-pump"] });
  const h = proposeHarness({ catalog: layoutCatalog(), layouts });
  const outcome = await h.call("propose_mimicLayout_create", { body: CREATE_LAYOUT });
  expect(outcome).toMatchObject({ ok: false, error: PROPOSE_LAYOUT_ROLES_MISSING(["raw-water-pump"]) });
  expect(outcome.error).not.toContain("assetRole.create");
}

/** Ruling Q4: an organization admin gets the sentence form, which never offers assetRole.create. */
export async function anOrgAdminsLayoutWithAMissingRoleGetsTheSentenceForm(): Promise<void> {
  const { layouts } = fakeLayouts({ missing: ["raw-water-pump"] });
  const h = proposeHarness({ catalog: layoutCatalog(), layouts });
  const ctx = { identity: { id: USER, role: "organization_admin", organizationId: ORG_X } as ResolvedIdentity };
  const outcome = await h.call("propose_mimicLayout_create", { body: CREATE_LAYOUT }, ctx);
  expect(outcome).toMatchObject({ ok: false, error: PROPOSE_LAYOUT_ROLES_MISSING(["raw-water-pump"]) });
  expect(outcome.error).not.toContain("assetRole.create");
  expect(h.stored).toEqual([]);
}

/**
 * A replace may keep a retired role its stored drawing carries (`assertReplaceLive`): a code
 * `missingRoleCodes` reports is refused only when the service refuses the body too.
 */
export async function aReplaceKeepingAStoredRetiredRoleIsStored(): Promise<void> {
  const { layouts, calls } = fakeLayouts({ missing: ["raw-water-pump"] });
  const h = proposeHarness({ catalog: layoutCatalog(), layouts });
  expect((await h.call("propose_mimicLayout_replace", { id: LAYOUT_ID, body: REPLACE_LAYOUT })).ok).toBe(true);
  expect(calls.validated).toEqual([{ kind: "replace", id: LAYOUT_ID }]);
}

/** The same replace, when the service refuses the body, gets the role sentence, not the route's bare one. */
export async function aReplaceWithATrulyMissingRoleGetsTheRoleSentence(): Promise<void> {
  const { layouts } = fakeLayouts({ missing: ["raw-water-pump"], refuse: new BadRequestException(UNKNOWN_ROLE_MESSAGE) });
  const h = proposeHarness({ catalog: layoutCatalogWithRoleTool(), layouts });
  const outcome = await h.call("propose_mimicLayout_replace", { id: LAYOUT_ID, body: REPLACE_LAYOUT });
  expect(outcome).toMatchObject({ ok: false, error: PROPOSE_LAYOUT_ROLES_MISSING_ADMIN(["raw-water-pump"]) });
  expect(h.stored).toEqual([]);
}

/**
 * A replace keeping a stored retired role, at a stale version: `missingRoleCodes` reports the kept
 * code, and the refusal is still the route's 409 sentence, not the role sentence (Q4-d).
 */
export async function aStaleReplaceKeepingARetiredRoleGetsTheStaleSentence(): Promise<void> {
  const { layouts } = fakeLayouts({ missing: ["raw-water-pump"], refuse: new ConflictException(MIMIC_LAYOUT_STALE_MESSAGE) });
  const h = proposeHarness({ catalog: layoutCatalogWithRoleTool(), layouts });
  const outcome = await h.call("propose_mimicLayout_replace", { id: LAYOUT_ID, body: REPLACE_LAYOUT });
  expect(outcome).toMatchObject({ ok: false, error: MIMIC_LAYOUT_STALE_MESSAGE });
  expect(h.stored).toEqual([]);
}

/** The same replace, when the service fails with a non-HTTP error, re-throws it rather than naming a role. */
export async function aReplaceKeepingARetiredRoleRethrowsADatabaseError(): Promise<void> {
  const { layouts } = fakeLayouts({ missing: ["raw-water-pump"], refuse: new Error("connection reset") });
  const h = proposeHarness({ catalog: layoutCatalogWithRoleTool(), layouts });
  // `runToolCall` turns a thrown dispatch into its generic failure: proof the error was thrown, not mapped.
  const outcome = await h.call("propose_mimicLayout_replace", { id: LAYOUT_ID, body: REPLACE_LAYOUT });
  expect(outcome).toMatchObject({ ok: false, error: "The tool failed. Try again or continue without it." });
  expect(h.stored).toEqual([]);
}

/** A tool set built without the layouts service never stores a layout card. */
export async function aLayoutWithoutTheServiceIsRefused(): Promise<void> {
  const h = proposeHarness({ catalog: layoutCatalog() });
  const outcome = await h.call("propose_mimicLayout_create", { body: CREATE_LAYOUT });
  expect(outcome).toMatchObject({ ok: false, error: PROPOSE_LAYOUT_UNAVAILABLE_ERROR });
  expect(h.stored).toEqual([]);
}

/** A baseline the model sends itself is refused by the strict body: only the server writes it. */
export async function aModelSentBaselineIsRefused(): Promise<void> {
  const { layouts, calls } = fakeLayouts();
  const h = proposeHarness({ catalog: layoutCatalog(), layouts });
  const outcome = await h.call("propose_mimicLayout_replace", { id: LAYOUT_ID, body: { ...REPLACE_LAYOUT, baseline: BASELINE } });
  expect(outcome.ok).toBe(false);
  expect(outcome.error).toMatch(/^Invalid body: /);
  expect(calls.validated).toEqual([]);
  expect(h.stored).toEqual([]);
}

/**
 * `F4.266` (ADR 0090 Amendment 3 C6) — each layout tool's definition states
 * the node and pipe shape, so the model proposes a layout without first
 * reading it with `describe_change` (a live turn spent its calls there). The
 * guide is built from the write schemas in `@bms/shared/copilot`, so a new
 * flag or symbol reaches it without an edit here.
 */
export function theLayoutToolsNameTheNodeAndPipeShape(): void {
  const h = proposeHarness();
  for (const name of ["propose_mimicLayout_create", "propose_mimicLayout_replace"]) {
    const definition = h.tools.registry.definitions.find((d) => d.name === name);
    const json = JSON.stringify(definition ?? null);
    for (const needle of ['\\"fromKey\\"', '\\"toKey\\"', "isSwitching", "tank", "lift", "unit, panel or label"]) {
      expect(json.includes(needle), `${name} names ${needle}`).toBe(true);
    }
  }
}
