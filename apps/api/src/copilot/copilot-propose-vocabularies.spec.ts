import { expect } from "vitest";

import { catalogEntry, proposeToolName } from "@bms/shared/copilot";

import type { ResolvedIdentity } from "../auth/identity-resolver";
import { bodyHash } from "./body-hash";
import {
  FILL_STEP_TOOL,
  PROPOSE_FLEET_UNBOUND_ERROR,
  PROPOSE_LAYOUT_ROLES_MISSING_ADMIN,
  PROPOSE_ROLE_ERROR,
} from "./copilot-propose-tools";
import { proposeHarness } from "./copilot-propose-tools.spec";
import { listAssetRolesTool } from "./tools/list-asset-roles.tool";

/**
 * `F4.282` (ADR 0099 Amendment 8, Q17) — the propose tools over the real
 * location-type and unit-role entries: the global admin's alone, a bound
 * conversation only, and a fixed body for the two unit-role directions.
 * Vitest entry point: the sibling `.test.ts`.
 */

const ORG_X = "00000000-0000-4000-8000-0000000000aa";
const USER = "11111111-1111-4111-8111-111111111111";
const ROLE_CODE = "cooling-tower";
const TYPE_CODE = "pump_station";

export const VOCABULARY_TOOLS = [
  "locationType.create",
  "locationType.update",
  "locationType.deactivate",
  "locationType.reactivate",
  "assetRole.update",
  "assetRole.deactivate",
  "assetRole.reactivate",
].map((id) => proposeToolName({ id }));

/** The three copilot roles the vocabulary routes refuse (`requireGlobalAdmin`). */
export const REFUSED_ROLES = ["organization_admin", "location_admin", "asset_group_admin"] as const;
export type RefusedRole = (typeof REFUSED_ROLES)[number];

/** A valid argument object for each vocabulary tool. */
const ARGS: Readonly<Record<string, Record<string, unknown>>> = {
  propose_locationType_create: { body: { code: "pumping_station", label: "Pumping station" } },
  propose_locationType_update: { code: TYPE_CODE, body: { label: "Renamed" } },
  propose_locationType_deactivate: { code: TYPE_CODE },
  propose_locationType_reactivate: { code: TYPE_CODE },
  propose_assetRole_update: { code: ROLE_CODE, body: { label: "Renamed" } },
  propose_assetRole_deactivate: { code: ROLE_CODE },
  propose_assetRole_reactivate: { code: ROLE_CODE },
};

const identityOf = (role: string) => ({ id: USER, role, organizationId: ORG_X }) as ResolvedIdentity;

/** The global admin's registry names all seven tools. */
export function theVocabularyToolsAreInTheGlobalAdminsRegistry(): void {
  const names = proposeHarness().tools.registryFor({ access: true, role: "admin" }).definitions.map((d) => d.name);
  for (const tool of VOCABULARY_TOOLS) expect(names, tool).toContain(tool);
}

/** Another role's registry names none of the seven. */
export function theVocabularyToolsAreAbsentFor(role: RefusedRole): void {
  const names = proposeHarness().tools.registryFor({ access: true, role }).definitions.map((d) => d.name);
  expect(names.filter((name) => VOCABULARY_TOOLS.includes(name))).toEqual([]);
}

/** A direct dispatch by another role is refused by the role guard; nothing is resolved or stored. */
export async function aVocabularyToolCalledByIsRefused(role: RefusedRole): Promise<void> {
  const h = proposeHarness();
  for (const tool of VOCABULARY_TOOLS) {
    const result = await h.tools.dispatch(tool, ARGS[tool] as Record<string, unknown>, h.ctx({ identity: identityOf(role) }));
    expect(result, tool).toEqual({ ok: false, error: PROPOSE_ROLE_ERROR });
  }
  expect(h.resolved).toEqual([]);
  expect(h.stored).toEqual([]);
}

/** Ruling Q1: a vocabulary change in an unbound conversation is refused before the resolver is asked. */
export async function aVocabularyChangeNeedsABoundConversation(): Promise<void> {
  const h = proposeHarness();
  for (const tool of VOCABULARY_TOOLS) {
    const result = await h.tools.dispatch(tool, ARGS[tool] as Record<string, unknown>, h.ctx({ conversationOrganizationId: null }));
    expect(result, tool).toEqual({ ok: false, error: PROPOSE_FLEET_UNBOUND_ERROR });
  }
  expect(h.resolved).toEqual([]);
}

/** A fixed-body tool's definition has no `body` and requires the code alone. */
export function aFixedBodyToolDefinesNoBody(): void {
  const definition = proposeHarness().tools.registry.definitions.find((d) => d.name === "propose_assetRole_deactivate");
  const parameters = definition?.parameters as { properties: Record<string, unknown>; required: string[] };
  expect(Object.keys(parameters.properties)).toEqual(["code"]);
  expect(parameters.required).toEqual(["code"]);
}

/** A fixed-body tool called with a body is refused by the strict argument schema. */
export async function aFixedBodyToolRefusesABody(): Promise<void> {
  const h = proposeHarness();
  const refused = await h.call("propose_assetRole_deactivate", { code: ROLE_CODE, body: { active: true } });
  expect(refused.ok).toBe(false);
  expect(h.stored).toEqual([]);
}

/** A fixed-body tool stores the fixed body and its canonical hash. */
export async function aFixedBodyToolStoresTheFixedBody(): Promise<void> {
  const h = proposeHarness();
  expect((await h.call("propose_assetRole_deactivate", { code: ROLE_CODE })).ok).toBe(true);
  expect(h.stored[0]?.body).toEqual({ active: false });
  expect(h.stored[0]?.bodyHash).toBe(bodyHash({ active: false }, []));
  expect(h.stored[0]?.path).toBe(`/api/v1/admin/vocabularies/asset-roles/${ROLE_CODE}`);
}

/** The reactivate twin stores `{ active: true }`. */
export async function theReactivateToolStoresActiveTrue(): Promise<void> {
  const h = proposeHarness();
  expect((await h.call("propose_assetRole_reactivate", { code: ROLE_CODE })).ok).toBe(true);
  expect(h.stored[0]?.body).toEqual({ active: true });
}

/** The location-type deactivate card states how many locations use the type. */
export async function theDeactivateCardStatesTheUsage(): Promise<void> {
  const h = proposeHarness({
    target: { organizationId: ORG_X, organizationName: "Org X", targetName: "Pump station", usageCount: 2 },
  });
  expect((await h.call("propose_locationType_deactivate", { code: TYPE_CODE })).ok).toBe(true);
  expect(h.stored[0]?.summary).toContain("used by 2 location");
  expect(h.stored[0]?.risk).toBe(catalogEntry("locationType.deactivate")?.risk);
}

/** The role edit refuses `active`: retirement is the direction entries'. */
export async function theRoleEditRefusesActive(): Promise<void> {
  const h = proposeHarness();
  const refused = await h.call("propose_assetRole_update", { code: ROLE_CODE, body: { active: false } });
  expect(refused.ok).toBe(false);
  expect(refused.content).toContain("Invalid body");
  expect(h.stored).toEqual([]);
}

/** A layout's missing role may be retired, so the global admin is told to reactivate before a create (which a retired code fails at Confirm). */
export function theAdminsMissingRoleSentenceTriesReactivateFirst(): void {
  const sentence = PROPOSE_LAYOUT_ROLES_MISSING_ADMIN([ROLE_CODE]);
  expect(sentence).toContain("propose assetRole.reactivate first, and assetRole.create only if the reactivate is refused");
}

/** The role list's description says an unlisted role may be retired, and how a retired one comes back. */
export function theRoleListNamesTheReactivatePath(): void {
  expect(listAssetRolesTool.description).toContain("absent or retired");
  expect(listAssetRolesTool.description).toContain("proposes assetRole.reactivate for it first");
}

/** D3 on the server: `fill_step` for the role edit refuses `active`, so a fill never claims to retire a role. */
export async function theRoleEditFillRefusesActive(): Promise<void> {
  const h = proposeHarness();
  const openWizards = [{ catalogId: "assetRole.update", params: { code: ROLE_CODE }, name: null, organizationId: null }];
  const fill = (values: Record<string, unknown>) =>
    h.call(FILL_STEP_TOOL, { catalogId: "assetRole.update", params: { code: ROLE_CODE }, stepId: "role", values }, { openWizards });
  expect((await fill({ active: false })).ok).toBe(false);
  expect(h.lastResult()).toMatchObject({ ok: false, error: expect.stringContaining("Invalid values") });
  // The positive control: the same fill without `active` lands.
  expect((await fill({ sortOrder: 40 })).ok).toBe(true);
}
