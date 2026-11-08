/**
 * `F4.339` (ADR 0117 decision 4) — the point-key gate accepts catalog keys.
 *
 * The BCPL drafts mapped every point to an active catalog key, declared none,
 * and stayed at "Add a point key: say kw". With the catalog, a draft whose
 * every mapping names a declared or an active catalog key needs no keys.
 */
import type { OnboardingDraft } from "@bms/shared";

import { OnboardingChatService } from "./onboarding-chat.service";
import { EMPTY_PLACEMENT } from "./onboarding-location-parent";
import { EMPTY_TEMPLATE_CONTEXT, type ValidateTemplateContext } from "./onboarding-template-refs";
import { draftNeedsPointKeys, OnboardingValidateService } from "./onboarding-validate.service";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const CODES = ["smoc_campus"];
const CATALOG: ReadonlyMap<string, boolean> = new Map([
  ["kw", true],
  ["kwh", true],
  ["old_key", false],
]);
const CONTEXT: ValidateTemplateContext = { ...EMPTY_TEMPLATE_CONTEXT, pointKeys: CATALOG };

/** Two mappings to catalog keys and no declared keys — the BCPL shape. */
export function catalogOnlyDraft(pointKeys: readonly string[] = ["kw", "kwh"]): OnboardingDraft {
  return {
    location: { name: "Lalpur", slug: "lalpur", code: "LALPUR", type: "smoc_campus", latitude: 26.1, longitude: 91.7 },
    rtus: [
      { code: "RTU-1", displayName: "RTU 1", protocol: "modbus_tcp", config: { host: "10.0.0.1", port: 502 }, credentialsSet: false, ingestEnabled: false },
    ],
    assets: [{ code: "LALPUR-FM1", name: "FM1", siteName: "Lalpur", rtuIndex: 0, domain: "electrical" }],
    assetPoints: pointKeys.map((pointKey, i) => ({ assetIndex: 0, pointKey, sourceDataKey: `s0${i}` })),
  } as OnboardingDraft;
}

export function assertCatalogOnlyMappingsReachReviewAndCommit(): void {
  const service = new OnboardingValidateService();
  const draft = catalogOnlyDraft();
  assert(service.inferPhase(draft, CODES, EMPTY_PLACEMENT, CATALOG) === "review", "two active catalog keys → review");
  const result = service.validate(draft, CODES, CONTEXT, EMPTY_PLACEMENT);
  assert(result.readyToCommit, `validate is ready to commit, got ${JSON.stringify(result.errors)} / ${result.suggestedPhase}`);
}

export function assertAnInactiveCatalogKeyKeepsThePointKeyPhase(): void {
  const service = new OnboardingValidateService();
  assert(service.inferPhase(catalogOnlyDraft(["kw", "old_key"]), CODES, EMPTY_PLACEMENT, CATALOG) === "point_keys", "an inactive key → point_keys");
}

export function assertNoMappingsAndNoKeysStillNeedKeys(): void {
  const draft = { ...catalogOnlyDraft(), assetPoints: [] } as OnboardingDraft;
  assert(draftNeedsPointKeys(draft, CATALOG), "no mappings and no keys → still needs keys");
}

export function assertWithoutTheCatalogTheGateFailsClosed(): void {
  const service = new OnboardingValidateService();
  assert(service.inferPhase(catalogOnlyDraft(), CODES, EMPTY_PLACEMENT) === "point_keys", "no catalog → point_keys");
  assert(draftNeedsPointKeys(catalogOnlyDraft()), "no catalog → the old rule");
}

/** A declared key counts beside catalog keys. */
export function assertADeclaredKeyCountsBesideCatalogKeys(): void {
  const draft = { ...catalogOnlyDraft(["kw", "new_key"]), pointKeys: [] } as OnboardingDraft;
  assert(draftNeedsPointKeys(draft, CATALOG), "an undeclared, uncatalogued key still needs keys");
}

/** A guided chat service whose template context carries `CATALOG` (or the empty one). */
function guidedService(context: ValidateTemplateContext): OnboardingChatService {
  return new OnboardingChatService(
    new OnboardingValidateService(),
    {} as never,
    {} as never,
    { listPointKeys: async () => [] } as never,
    { listLocationTypes: async () => [{ code: "smoc_campus", label: "SMOC campus" }] } as never,
    { resolveForOrganization: async () => ({ kind: "guided", reason: "platform_off" }) } as never,
    { context: async () => context, pointKeyQuota: async () => "exempt" } as never,
    { listExisting: async () => ({ rows: [], total: 0 }), listParentCandidates: async () => [] } as never,
  );
}

const KW_PROMPT = "Add a point key: say **kw** to add the catalog key **kw**.";

/** Plan T2.1: "confirm point keys" on the catalog-only draft moves on instead of asking for kw; without the catalog it asks. */
export async function assertConfirmPointKeysMovesOnForACatalogOnlyDraft(): Promise<void> {
  const turn = (context: ValidateTemplateContext) =>
    guidedService(context).handleTurn("confirm point keys", catalogOnlyDraft(), "point_keys", "Ion Exchange", "org-1", {
      sessionId: "s-1",
      history: [],
      pointKeyQuota: { createdByOrganization: 0 },
    });
  const moved = await turn(CONTEXT);
  assert(!moved.assistantMessage.includes(KW_PROMPT), `the catalog-only draft moves on, got ${moved.assistantMessage}`);
  assert(moved.draftPatch.pointKeys === undefined, "no kw is added");
  assert(moved.currentPhase === "review", `the phase is review, got ${moved.currentPhase}`);
  const asked = await turn(EMPTY_TEMPLATE_CONTEXT);
  assert(asked.currentPhase === "point_keys", `without the catalog the gate holds, got ${asked.currentPhase}`);
}
