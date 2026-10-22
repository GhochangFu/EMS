/**
 * `F4.243` (ADR 0098 Amendment 2, B7) — the agent's `set_location` takes a
 * parent by code. A code the commit would refuse is refused here with the
 * guard's sentence; a stored parent survives a later rename.
 */
import type { OnboardingDraft } from "@bms/shared";

import { runTool, type ToolContext, type ToolState } from "./onboarding-agent-tools";
import { deriveLocationPatch } from "./onboarding-location-derive";
import type { ParentCandidate } from "./onboarding-location-parent";
import { EMPTY_TEMPLATE_CONTEXT } from "./onboarding-template-refs";
import { OnboardingValidateService } from "./onboarding-validate.service";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const CANDIDATES: readonly ParentCandidate[] = [
  { code: "CAMPUS-1", name: "Thane Campus", active: true, depth: 1 },
  { code: "OLD-SITE", name: "Old site", active: false, depth: 1 },
];

function context(): ToolContext {
  return {
    organizationId: "org-1",
    activeTypes: [{ code: "pump_station", label: "Pump station" }],
    catalog: { listPointKeys: async () => [], listInUsePointKeys: async () => new Set<string>() },
    protocols: {
      getContextForOrganization: async () => ({ catalog: [], orgExamples: [] }),
      formatForAssistant: () => "MQTT",
    },
    validator: new OnboardingValidateService(),
    templates: EMPTY_TEMPLATE_CONTEXT,
    pointKeyQuota: { createdByOrganization: 0 },
    inventory: { listExisting: async () => ({ rows: [], total: 0 }) },
    placement: { candidates: CANDIDATES },
  };
}

function call(args: unknown): { id: string; name: string; arguments: string } {
  return { id: "c1", name: "set_location", arguments: JSON.stringify(args) };
}

/** A1 — an unknown parent is refused with the guard's sentence and the hint, and writes nothing. */
export async function assertAnUnknownParentIsRefused(): Promise<void> {
  const state: ToolState = { working: {} };
  const out = await runTool(call({ name: "Thane Pump", type: "pump_station", parentCode: "NOPE" }), state, context());
  assert(
    !out.ok && out.content.includes("Parent location not found. Call find_existing with kind"),
    `expected the not-found refusal, got ${JSON.stringify(out)}`,
  );
}

/** A2 — an inactive parent is refused with its sentence. */
export async function assertAnInactiveParentIsRefused(): Promise<void> {
  const state: ToolState = { working: {} };
  const out = await runTool(call({ name: "Thane Pump", type: "pump_station", parentCode: "OLD-SITE" }), state, context());
  assert(
    !out.ok && out.content.includes("The parent location is inactive."),
    `expected the inactive refusal, got ${JSON.stringify(out)}`,
  );
}

/** A3 — an active parent is written, and the action line names it. */
export async function assertAnActiveParentIsWrittenWithItsActionLine(): Promise<void> {
  const state: ToolState = { working: {} };
  const out = await runTool(call({ name: "Thane Pump", type: "pump_station", parentCode: "CAMPUS-1" }), state, context());
  assert(
    out.ok && state.working.location?.parentCode === "CAMPUS-1" && out.actionLine === "Set location Thane Pump (pump_station) under CAMPUS-1",
    `expected the parent written and named, got ${JSON.stringify(out)} / ${JSON.stringify(state.working.location)}`,
  );
}

/** A4 — `null` is a top-level location, and the action line says so. */
export async function assertANullParentIsATopLevelLocation(): Promise<void> {
  const state: ToolState = { working: {} };
  const out = await runTool(call({ name: "Thane Pump", type: "pump_station", parentCode: null }), state, context());
  assert(
    out.ok && state.working.location?.parentCode === null && out.actionLine === "Set location Thane Pump (pump_station) as a top-level location",
    `expected a top-level location, got ${JSON.stringify(out)} / ${JSON.stringify(state.working.location)}`,
  );
}

/**
 * A5 — a rename that names no parent keeps the stored one. The draft merge
 * (`mergeDraftPatch`, absent keeps stored) holds this too, so mutation 8
 * alone leaves A5 green; A5b is the carry's own gate.
 */
export async function assertARenameKeepsTheStoredParent(): Promise<void> {
  const stored: OnboardingDraft = {
    location: {
      name: "Thane Pump",
      slug: "thane-pump",
      code: "THANE_PUMP",
      type: "pump_station",
      latitude: 19.2,
      longitude: 72.9,
      parentCode: "CAMPUS-1",
    },
  };
  const state: ToolState = { working: stored };
  const out = await runTool(call({ name: "Thane Pump Station" }), state, context());
  assert(
    out.ok && state.working.location?.parentCode === "CAMPUS-1",
    `the stored parent survives the rename, got ${JSON.stringify(state.working.location)}`,
  );
}

/** A5b — `deriveLocationPatch` carries the stored parent into the patch it derives. Mutation 8 reddens it. */
export function assertTheDerivedPatchCarriesTheStoredParent(): void {
  const derived = deriveLocationPatch({ name: "Thane Pump Station", stored: { parentCode: "CAMPUS-1" } });
  assert(derived.parentCode === "CAMPUS-1", `the derived patch carries the parent, got ${JSON.stringify(derived)}`);
}
