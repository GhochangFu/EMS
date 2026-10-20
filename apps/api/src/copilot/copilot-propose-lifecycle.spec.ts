import { expect } from "vitest";

import { archiveRefusedMessage, draftRequiredMessage, instantiateRefusedMessage, type TemplateLifecycleStatus } from "@bms/shared";

import { PROPOSE_STORED_CONTENT_ERROR, PROPOSE_TARGET_ERROR } from "./copilot-propose-tools";
import { proposeHarness } from "./copilot-propose-tools.spec";
import type { ResolvedTarget } from "./copilot-target-resolver";

/**
 * `F4.246` — a propose tool refuses, at propose time, a template whose status
 * the route would refuse at Confirm, with the route's own sentence, so the
 * model corrects itself instead of the user meeting a 409. Each refusal sits
 * beside its admitted twin (an absence check alone proves nothing). The real
 * catalog, a fake resolver and a fake pending store (`proposeHarness`).
 * Vitest entry point: the sibling `.test.ts`.
 */

const ORG_X = "00000000-0000-4000-8000-0000000000aa";
const ORG_Y = "00000000-0000-4000-8000-0000000000bb";
const ROW = "33333333-3333-4333-8333-333333333333";
const SITE = "66666666-6666-4666-8666-666666666666";

const target = (status: TemplateLifecycleStatus | undefined, over: Partial<ResolvedTarget> = {}): ResolvedTarget => ({
  organizationId: ORG_X,
  organizationName: "Org X",
  targetName: "Pump template",
  pointKeys: ["kw"],
  currentContent: {},
  ...(status !== undefined ? { status } : {}),
  ...over,
});

/** `assetTemplate.update` on a published version: the route's edit sentence, nothing stored; a draft stores. */
export async function anEditOfAPublishedTemplateStoresNothing(): Promise<void> {
  const h = proposeHarness({ target: target("published") });
  const refused = await h.call("propose_assetTemplate_update", { id: ROW, body: { name: "x" } });
  expect(refused.error).toBe(draftRequiredMessage("published", "edited"));
  expect(h.stored).toEqual([]);
  const draft = proposeHarness({ target: target("draft") });
  expect((await draft.call("propose_assetTemplate_update", { id: ROW, body: { name: "x" } })).ok).toBe(true);
  expect(draft.stored).toHaveLength(1);
}

/** `dashboardTemplate.publish` on a published version: the route's publish sentence; a draft stores. */
export async function aPublishOfAPublishedDashboardTemplateStoresNothing(): Promise<void> {
  const h = proposeHarness({ target: target("published") });
  const refused = await h.call("propose_dashboardTemplate_publish", { id: ROW });
  expect(refused.error).toBe(draftRequiredMessage("published", "published"));
  expect(h.stored).toEqual([]);
  const draft = proposeHarness({ target: target("draft") });
  expect((await draft.call("propose_dashboardTemplate_publish", { id: ROW })).ok).toBe(true);
}

/** `assetTemplate.archive` on a draft: the route's archive sentence; a published version stores. */
export async function anArchiveOfADraftStoresNothing(): Promise<void> {
  const h = proposeHarness({ target: target("draft") });
  const refused = await h.call("propose_assetTemplate_archive", { id: ROW });
  expect(refused.error).toBe(archiveRefusedMessage("draft"));
  expect(h.stored).toEqual([]);
  const published = proposeHarness({ target: target("published") });
  expect((await published.call("propose_assetTemplate_archive", { id: ROW })).ok).toBe(true);
}

/** `assetTemplate.instantiate` on a draft: the asset route's two sentences; a published version stores. */
export async function anInstantiateOfADraftAssetTemplateStoresNothing(): Promise<void> {
  const body = { locationId: SITE, assets: [{ code: "P-1", name: "Pump 1" }] };
  const h = proposeHarness({ target: target("draft") });
  const refused = await h.call("propose_assetTemplate_instantiate", { id: ROW, body });
  expect(refused.error).toBe(instantiateRefusedMessage("draft", "asset"));
  expect(h.stored).toEqual([]);
  const published = proposeHarness({ target: target("published") });
  expect((await published.call("propose_assetTemplate_instantiate", { id: ROW, body })).ok).toBe(true);
}

/** A template target the resolver gave no status refuses as an unknown target (fail closed). */
export async function aTemplateTargetWithoutAStatusIsRefused(): Promise<void> {
  const h = proposeHarness({ target: target(undefined) });
  const refused = await h.call("propose_assetTemplate_update", { id: ROW, body: { name: "x" } });
  expect(refused.error).toBe(PROPOSE_TARGET_ERROR);
  expect(h.stored).toEqual([]);
}

/**
 * Decision 10 first: a published target outside the allowed set answers the
 * target refusal, never the lifecycle sentence — the model learns nothing
 * about a row it may not change.
 */
export async function theStatusCheckRunsAfterTheTargetCheck(): Promise<void> {
  const h = proposeHarness({ target: target("published", { organizationId: ORG_Y }) });
  const refused = await h.call("propose_assetTemplate_update", { id: ROW, body: { name: "x" } });
  expect(refused.error).toBe(PROPOSE_TARGET_ERROR);
  expect(h.stored).toEqual([]);
}

/**
 * The status check runs before the stored content is merged: a published
 * template whose stored content could not be written back answers the
 * lifecycle sentence, not the stored-content one. The draft twin, on the
 * same stored content, proves that content does make the merge refuse — so
 * the published answer is the order, not a content that merges cleanly.
 */
export async function theStatusCheckRunsBeforeTheContentMerge(): Promise<void> {
  const stored = { currentContent: { optimisation: {} } };
  const body = { content: { kpis: [] } };
  const h = proposeHarness({ target: target("published", stored) });
  const refused = await h.call("propose_assetTemplate_update", { id: ROW, body });
  expect(refused.error).toBe(draftRequiredMessage("published", "edited"));
  expect(h.stored).toEqual([]);
  const draft = proposeHarness({ target: target("draft", stored) });
  const merged = await draft.call("propose_assetTemplate_update", { id: ROW, body });
  expect(merged.error?.startsWith(PROPOSE_STORED_CONTENT_ERROR)).toBe(true);
  expect(draft.stored).toEqual([]);
}
