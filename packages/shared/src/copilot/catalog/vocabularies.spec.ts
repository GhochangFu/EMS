import { expect } from "vitest";

import { copilotUpdateAssetRoleModelBodySchema, updateAssetRoleBodySchema } from "../../contracts/asset-role-writes";
import { stepProblems } from "./catalog.spec";
import { catalogEntry, COPILOT_CATALOG, EXCLUDED_ROUTES } from "./index";
import type { CatalogEntry } from "./types";

/**
 * `F4.282` (ADR 0099 Amendment 8, Q17) — the location-type and unit-role
 * vocabulary entries. The rules every entry obeys are `catalog.spec.ts`; this
 * file holds what is particular to these seven. Vitest entry point: the
 * sibling `.test.ts`.
 */

const LOCATION_TYPE_IDS = ["locationType.create", "locationType.update", "locationType.deactivate", "locationType.reactivate"];
const ROLE_IDS = ["assetRole.update", "assetRole.deactivate", "assetRole.reactivate"];
const VOCABULARY_IDS = [...LOCATION_TYPE_IDS, ...ROLE_IDS];

function entry(id: string): CatalogEntry {
  const found = catalogEntry(id);
  if (!found) throw new Error(`no catalog entry ${id}`);
  return found;
}

/** Ruling Q17 / D1: each of the seven is offered to the global admin alone, with no secret and no precondition. */
export function theSevenVocabularyEntriesAreForTheGlobalAdminAlone(): void {
  for (const id of VOCABULARY_IDS) {
    const found = entry(id);
    expect({ offeredTo: found.offeredTo, clientOnly: found.clientOnly, precondition: found.precondition }, id).toEqual({
      offeredTo: ["admin"],
      clientOnly: [],
      precondition: undefined,
    });
  }
}

/** D3: one entry per direction; the two deactivates are red, the reactivates and edits are edits. */
export function theDirectionEntriesCarryTheRuledRisk(): void {
  expect(Object.fromEntries(VOCABULARY_IDS.map((id) => [id, entry(id).risk]))).toEqual({
    "locationType.create": "create",
    "locationType.update": "edit",
    "locationType.deactivate": "deactivate",
    "locationType.reactivate": "edit",
    "assetRole.update": "edit",
    "assetRole.deactivate": "deactivate",
    "assetRole.reactivate": "edit",
  });
}

/** D2: every row entry names its `code` parameter on a `vocabulary` target; the create is `fleet`. */
export function theVocabularyTargetsNameTheCodeParameter(): void {
  expect(entry("locationType.create").target).toEqual({ kind: "fleet" });
  for (const id of LOCATION_TYPE_IDS.slice(1)) {
    expect(entry(id).target, id).toEqual({ kind: "vocabulary", of: "locationType", param: "code" });
  }
  for (const id of ROLE_IDS) expect(entry(id).target, id).toEqual({ kind: "vocabulary", of: "assetRole", param: "code" });
}

/** A fixed body parses with the route's own body, and its wizard has no step. */
export function aFixedBodyParsesWithTheRoutesBody(): void {
  const fixed = COPILOT_CATALOG.filter((candidate) => candidate.fixedBody !== undefined);
  // `F4.278` adds the two rule directions on the toggle route (Amendment 8 D3).
  expect(fixed.map((candidate) => candidate.id).sort()).toEqual(["assetRole.deactivate", "assetRole.reactivate", "rule.disable", "rule.enable"]);
  for (const candidate of fixed) {
    expect(candidate.body.safeParse(candidate.fixedBody).success, candidate.id).toBe(true);
    expect(candidate.steps, candidate.id).toEqual([]);
  }
  // Positive control: the route's body refuses a wrong-typed `active`, so the parse above is a real check.
  expect(updateAssetRoleBodySchema.safeParse({ active: "no" }).success).toBe(false);
}

/** The direction entries' fixed bodies are the two values of `active`. */
export function theFixedBodiesAreTheTwoDirections(): void {
  expect(entry("assetRole.deactivate").fixedBody).toEqual({ active: false });
  expect(entry("assetRole.reactivate").fixedBody).toEqual({ active: true });
}

/** The step rule refuses a fixed-body entry that has a step. */
export function theFixedBodyStepRuleIsNotVacuous(): void {
  const base = entry("assetRole.deactivate");
  const step = { id: "role", title: "Role", fields: ["active"] };
  expect(stepProblems({ ...base, steps: [step] })).toEqual(["assetRole.deactivate: a fixed-body entry has steps"]);
}

/** Q17 withdraws Amendment 3 A1: no vocabulary route stays on the exclusion list. */
export function noVocabularyRouteIsExcluded(): void {
  expect(EXCLUDED_ROUTES.filter((route) => route.path.startsWith("/admin/vocabularies/"))).toEqual([]);
}

/** The deactivate card states how many locations use the type, and says so when it is unknown. */
export function theDeactivateSummaryStatesTheUsage(): void {
  const input = { body: {}, params: { code: "pump_station" }, targetName: "Pump station", organizationName: "Org" };
  const deactivate = entry("locationType.deactivate");
  expect(deactivate.summary({ ...input, usageCount: 3 })).toContain("used by 3 location");
  expect(deactivate.summary(input)).toContain("an unknown number of");
}

/** The copilot's count is the bound organization's only, so its card names it; the page's fleet count names none. */
export function theCopilotDeactivateSummaryNamesTheCountedOrganization(): void {
  const input = { body: {}, params: { code: "pump_station" }, targetName: "Pump station", usageCount: 5 };
  const deactivate = entry("locationType.deactivate");
  expect(deactivate.summary({ ...input, organizationName: "Org A" })).toContain(
    "used by 5 location(s) in Org A (other organizations' locations are not counted)",
  );
  expect(deactivate.summary({ ...input, organizationName: "" })).toContain("used by 5 location(s): every Type");
}

/** The role edit's model body has no `active`: retirement is the direction entries'. */
export function theModelBodyOfTheRoleEditHasNoActive(): void {
  expect(copilotUpdateAssetRoleModelBodySchema.safeParse({ active: false }).success).toBe(false);
  expect(copilotUpdateAssetRoleModelBodySchema.safeParse({ label: "x" }).success).toBe(true);
  expect(entry("assetRole.update").modelBody).toBe(copilotUpdateAssetRoleModelBodySchema);
}

/** D3: the role edit's step has no `active` either, so `fill_step` and `describe_change` never offer it. */
export function theRoleEditStepHasNoActive(): void {
  const fields = entry("assetRole.update").steps.flatMap((step) => step.fields);
  expect(fields).toEqual(["label", "sortOrder"]);
}

/** Each summary names the code beside the label. */
export function theSummariesNameTheCode(): void {
  const input = { body: { label: "New" }, params: { code: "cooling-tower" }, targetName: "Cooling tower", organizationName: "Org" };
  for (const id of ROLE_IDS) expect(entry(id).summary(input), id).toContain('"Cooling tower" (cooling-tower)');
}
