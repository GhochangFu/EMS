import { expect } from "vitest";

import { catalogEntry, type CatalogEntry } from "@bms/shared/copilot";

import { type CopilotOpenWizardRecord, FILL_AMBIGUOUS_WIZARD_ERROR, FILL_NO_OPEN_WIZARD_ERROR } from "./copilot-open-wizards";
import { FILL_STEP_TOOL } from "./copilot-propose-tools";
import { proposeHarness } from "./copilot-propose-tools.spec";

/**
 * `F4.245` / ADR 0099 Amendment 4 — `fill_step` names its record and the
 * server checks it: a fill lands only in a wizard open on the user's screen
 * for that record (or, in the turn that opened its page, the record that page
 * shows), and a record outside the conversation's scope is never open. In its
 * own file: `copilot-propose-tools.spec.ts` is at the line cap (critique F1).
 * Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

const ORG_X = "00000000-0000-4000-8000-0000000000aa";
const ORG_Y = "00000000-0000-4000-8000-0000000000bb";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const VALUES = { name: "Main" };

const record = (catalogId: string, params: Record<string, string>, organizationId: string | null = ORG_X): CopilotOpenWizardRecord => ({
  catalogId,
  params,
  name: "Dashboard",
  organizationId,
});

const updateOf = (id: string) => ({ catalogId: "dashboard.update", params: { id }, stepId: "basics", values: VALUES });

/** Mutation: `fillRecordRefusal` answers `null` — the fill with nothing open is accepted. */
export async function aFillWithNoOpenWizardIsRefused(): Promise<void> {
  const h = proposeHarness();
  await h.call(FILL_STEP_TOOL, { catalogId: "dashboard.create", params: {}, stepId: "basics", values: VALUES });
  expect(h.lastResult()).toEqual({ ok: false, error: FILL_NO_OPEN_WIZARD_ERROR });
}

/** Mutation: put the first open wizard's params on the fill — B's, listed first. */
export async function aFillForTheOpenRecordCarriesItsParams(): Promise<void> {
  const h = proposeHarness();
  const openWizards = [record("dashboard.update", { id: B }), record("dashboard.update", { id: A })];
  expect((await h.call(FILL_STEP_TOOL, updateOf(A), { openWizards })).ok).toBe(true);
  const result = h.lastResult();
  expect(result?.ok && result.fillStep).toStrictEqual({ catalogId: "dashboard.update", params: { id: A }, stepId: "basics", values: VALUES });
  expect(h.stored).toEqual([]);
  expect(h.resolved).toEqual([]);
}

/** The backlog row's case: a conversation about A with B's wizard open. Mutation: match on `catalogId` alone → accepted. */
export async function aFillForAnotherRecordIsRefused(): Promise<void> {
  const h = proposeHarness();
  await h.call(FILL_STEP_TOOL, updateOf(A), { openWizards: [record("dashboard.update", { id: B })] });
  expect(h.lastResult()).toEqual({ ok: false, error: FILL_NO_OPEN_WIZARD_ERROR });
}

/** Mutation: refuse only above two copies (`> 2`) — the fill for a duplicated record is accepted. */
export async function twoOpenWizardsOfOneRecordRefuseTheFill(): Promise<void> {
  const h = proposeHarness();
  await h.call(FILL_STEP_TOOL, updateOf(A), { openWizards: [record("dashboard.update", { id: A }), record("dashboard.update", { id: A })] });
  expect(h.lastResult()).toEqual({ ok: false, error: FILL_AMBIGUOUS_WIZARD_ERROR });
}

/** Owner ruling (nav): a page this turn opened mounts the record. Mutation: drop the `pageWizards` branch → refused. */
export async function aFillForAPageThisTurnOpenedIsAccepted(): Promise<void> {
  const h = proposeHarness();
  await h.call(FILL_STEP_TOOL, updateOf(A), { pageWizards: [record("dashboard.update", { id: A })] });
  expect(h.lastResult()).toMatchObject({ ok: true, fillStep: { params: { id: A } } });
}

/** The page's record and no other: a page for A does not admit a fill for B. */
export async function aFillForAnotherRecordThanThePagesIsRefused(): Promise<void> {
  const h = proposeHarness();
  await h.call(FILL_STEP_TOOL, updateOf(B), { pageWizards: [record("dashboard.update", { id: A })] });
  expect(h.lastResult()).toEqual({ ok: false, error: FILL_NO_OPEN_WIZARD_ERROR });
}

/** Mutation: `params` optional in the argument schema — the definition no longer requires it. */
export function theFillDefinitionRequiresTheParams(): void {
  const h = proposeHarness();
  const definition = h.tools.registry.definitions.find((d) => d.name === FILL_STEP_TOOL);
  expect((definition?.parameters as { required?: string[] }).required).toContain("params");
}

/** The record is resolved inside the conversation's scope; its name is the resolver's. */
export async function anInScopeRecordIsOpenWithItsName(): Promise<void> {
  const h = proposeHarness();
  const found = await h.tools.openWizardRecords([{ catalogId: "dashboard.update", params: { id: A } }], h.ctx());
  expect(found).toStrictEqual([{ catalogId: "dashboard.update", params: { id: A }, name: "Template T", organizationId: ORG_X }]);
  expect(h.resolved).toEqual([{ id: "dashboard.update", params: { id: A }, allowed: [ORG_X], bound: ORG_X }]);
}

/** Security: a record of another organization than the bound conversation's is not open. Mutation: drop the bound check → red. */
export async function aRecordOfAnotherOrganizationIsNotOpen(): Promise<void> {
  const h = proposeHarness({ target: { organizationId: ORG_Y, organizationName: "Org Y", targetName: "Elsewhere" } });
  const ctx = h.ctx({ allowedOrganizationIds: [ORG_X, ORG_Y] });
  expect(await h.tools.openWizardRecords([{ catalogId: "dashboard.update", params: { id: A } }], ctx)).toEqual([]);
}

/** Security: a record outside the allowed set is not open, even in a cross-organization conversation. Mutation: drop the allowed check → red. */
export async function aRecordOutsideTheAllowedSetIsNotOpen(): Promise<void> {
  const h = proposeHarness({ target: { organizationId: ORG_Y, organizationName: "Org Y", targetName: "Elsewhere" } });
  const ctx = h.ctx({ conversationOrganizationId: null, allowedOrganizationIds: [ORG_X] });
  expect(await h.tools.openWizardRecords([{ catalogId: "dashboard.update", params: { id: A } }], ctx)).toEqual([]);
}

/** A record the resolver refuses (absent, or not the caller's to manage) is not open. */
export async function aRecordTheResolverRefusesIsNotOpen(): Promise<void> {
  const h = proposeHarness({ target: null });
  expect(await h.tools.openWizardRecords([{ catalogId: "dashboard.update", params: { id: A } }], h.ctx())).toEqual([]);
}

/** A create has no row: it is open with no name and the resolver is not asked. */
export async function aCreateIsOpenWithoutARead(): Promise<void> {
  const h = proposeHarness();
  const found = await h.tools.openWizardRecords([{ catalogId: "dashboard.create", params: {} }], h.ctx());
  expect(found).toStrictEqual([{ catalogId: "dashboard.create", params: {}, name: null, organizationId: null }]);
  expect(h.resolved).toEqual([]);
}

/** A server-proposed entry (the onboarding wizards) is never open to a fill. */
export async function anOnboardingWizardIsNeverOpen(): Promise<void> {
  const commit = catalogEntry("onboarding.commit") as CatalogEntry;
  const h = proposeHarness({ catalog: [commit] });
  expect(await h.tools.openWizardRecords([{ catalogId: "onboarding.commit", params: { id: A } }], h.ctx())).toEqual([]);
}

/** The edit page's slug is read in the allowed set and names both wizards. Mutation: use the slug as the id → red. */
export async function theDashboardEditPageNamesItsRecordBySlug(): Promise<void> {
  const h = proposeHarness({ slugId: A });
  const found = await h.tools.pageWizardRecords("/admin/dashboards/plant-a", h.ctx());
  expect(found.map((r) => [r.catalogId, r.params])).toEqual([
    ["dashboard.update", { id: A }],
    ["dashboard.widgets.replace", { id: A }],
  ]);
}

/** A slug no allowed organization has (or two have) names no wizard. */
export async function anUnknownSlugNamesNoWizard(): Promise<void> {
  const h = proposeHarness({ slugId: null });
  expect(await h.tools.pageWizardRecords("/admin/dashboards/plant-a", h.ctx())).toEqual([]);
  expect(h.resolved).toEqual([]);
}

/** A page's record outside the scope is not named either. */
export async function aPageRecordOutsideTheScopeIsNotNamed(): Promise<void> {
  const h = proposeHarness({ slugId: A, target: { organizationId: ORG_Y, organizationName: "Org Y", targetName: "Elsewhere" } });
  expect(await h.tools.pageWizardRecords("/admin/dashboards/plant-a", h.ctx({ allowedOrganizationIds: [ORG_X, ORG_Y] }))).toEqual([]);
}
