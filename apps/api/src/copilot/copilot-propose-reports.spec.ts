import { BadRequestException } from "@nestjs/common";
import { expect } from "vitest";

import { hashExcludedKeysFor, proposeToolName } from "@bms/shared/copilot";

import type { ResolvedIdentity } from "../auth/identity-resolver";
import type { ReportProposalCheckInput } from "../reports/report-proposal-check.service";
import { bodyHash } from "./body-hash";
import { PROPOSE_REPORT_EMAIL_NOT_ASKED_ERROR, PROPOSE_REPORT_EMAIL_ON_FOLLOW_UP_ERROR } from "./copilot-outward-intent";
import { PROPOSE_REPORTS_UNAVAILABLE_ERROR, REPORT_ENTRY_IDS } from "./copilot-propose-reports";
import { FILL_STEP_TOOL, PROPOSE_ROLE_ERROR } from "./copilot-propose-tools";
import { proposeHarness } from "./copilot-propose-tools.spec";
import type { ResolvedTarget } from "./copilot-target-resolver";

/**
 * `F4.280` (ADR 0099 Amendment 8, D2, D4, D5, Q14; owner rulings Q2, Q3, Q5,
 * Q7) — the propose tools over the real report entries, with a recording fake
 * of `ReportProposalCheckService`. D4 is per field: the tools stay offered, and
 * a body that starts email (`channelId` set, or `enabled: true` on a schedule
 * whose stored channel is set) is refused in a follow-up turn and in a turn
 * whose own message did not ask (`reportEmailIntent`). Vitest entry point: the
 * sibling `.test.ts`.
 */

const ORG_X = "00000000-0000-4000-8000-0000000000aa";
const USER = "11111111-1111-4111-8111-111111111111";
const ROW = "44444444-4444-4444-8444-444444444444";
const CHANNEL = "55555555-5555-4555-8555-555555555555";
const ADDRESS = "ops@example.test";
const RECIPIENTS = [{ channelId: CHANNEL, name: "Ops", kind: "email", targets: [ADDRESS] }];

const CREATE_TOOL = proposeToolName({ id: "reportSchedule.create" });
const UPDATE_TOOL = proposeToolName({ id: "reportSchedule.update" });
const SAVE_TOOL = proposeToolName({ id: "reportFile.save" });
const REPORT_TOOLS = [...REPORT_ENTRY_IDS].map((id) => proposeToolName({ id }));

const CREATE = {
  organizationId: ORG_X,
  name: "Weekly energy",
  formats: ["pdf"],
  cadence: "weekly",
  runAtLocal: "07:00",
  timezone: "Asia/Kolkata",
  locationIds: [],
};
const EMAILED = { ...CREATE, channelId: CHANNEL };
const SAVE = { organizationId: ORG_X, startDate: "2026-09-01", endDate: "2026-09-30", format: "pdf" };
const OPEN_CREATE = { openWizards: [{ catalogId: "reportSchedule.create", params: {}, name: null, organizationId: null }] };
const OPEN_UPDATE = { openWizards: [{ catalogId: "reportSchedule.update", params: { id: ROW }, name: "Weekly energy", organizationId: ORG_X }] };
const ASKED = { reportEmailIntent: true };

const target = (over: Partial<ResolvedTarget> = {}): ResolvedTarget => ({
  organizationId: ORG_X,
  organizationName: "Org X",
  targetName: "Weekly energy",
  ...over,
});

function checks(options: { refusal?: string; storedChannel?: boolean } = {}) {
  const calls: ReportProposalCheckInput[] = [];
  return {
    calls,
    fake: {
      check: async (input: ReportProposalCheckInput) => {
        calls.push(input);
        if (options.refusal !== undefined) throw new BadRequestException(options.refusal);
        const emailed = typeof input.body.channelId === "string";
        return {
          note: emailed ? 'Email delivery: channel "Ops", 1 recipient, on every run with no later Confirm.' : "Email delivery: none.",
          recipients: emailed ? RECIPIENTS : [],
        };
      },
      startsEmail: async (input: Omit<ReportProposalCheckInput, "organizationId">) =>
        typeof input.body.channelId === "string" ||
        (input.entryId === "reportSchedule.update" && input.body.enabled === true && options.storedChannel === true),
    },
  };
}

function harness(over: { refusal?: string; storedChannel?: boolean } = {}) {
  const c = checks(over);
  const h = proposeHarness({ target: target(), reports: c.fake });
  return { ...h, c };
}

const asRole = (role: string) => ({ identity: { id: USER, role, organizationId: ORG_X } as ResolvedIdentity });

function namesFor(role: string): string[] {
  return harness().tools.registryFor({ access: false, role }).definitions.map((d) => d.name);
}

/** D2: the global admin is offered the three report tools. */
export function theAdminRegistryHasTheReportTools(): void {
  expect(namesFor("admin")).toEqual(expect.arrayContaining(REPORT_TOOLS));
}

/** D2: an organization admin is offered the three report tools. */
export function theOrganizationAdminRegistryHasTheReportTools(): void {
  expect(namesFor("organization_admin")).toEqual(expect.arrayContaining(REPORT_TOOLS));
}

/** D2: a location admin is offered the three report tools. */
export function theLocationAdminRegistryHasTheReportTools(): void {
  expect(namesFor("location_admin")).toEqual(expect.arrayContaining(REPORT_TOOLS));
}

/** D2: an asset-group admin is offered none. */
export function theAssetGroupAdminRegistryHasNoReportTool(): void {
  const names = namesFor("asset_group_admin");
  expect(REPORT_TOOLS.filter((name) => names.includes(name))).toEqual([]);
}

/** D2: the second guard behind the registry refuses an asset-group admin. */
export async function anAssetGroupAdminIsRefusedByRole(): Promise<void> {
  const h = harness();
  await h.call(CREATE_TOOL, { body: CREATE }, asRole("asset_group_admin"));
  expect([h.lastResult(), h.stored]).toEqual([{ ok: false, error: PROPOSE_ROLE_ERROR }, []]);
}

/** D4, decision 4.7: a follow-up turn never proposes email delivery, even when the switch is on. */
export async function anEmailingCreateInAFollowUpIsRefused(): Promise<void> {
  const h = harness();
  await h.call(CREATE_TOOL, { body: EMAILED }, { turnKind: "follow_up", ...ASKED });
  expect([h.lastResult(), h.stored]).toEqual([{ ok: false, error: PROPOSE_REPORT_EMAIL_ON_FOLLOW_UP_ERROR }, []]);
}

/** D4: a create with `channelId` the message did not ask for is refused. */
export async function anEmailingCreateNotAskedIsRefused(): Promise<void> {
  const h = harness();
  await h.call(CREATE_TOOL, { body: EMAILED });
  expect([h.lastResult(), h.stored]).toEqual([{ ok: false, error: PROPOSE_REPORT_EMAIL_NOT_ASKED_ERROR }, []]);
}

/** D4: an update with `channelId` the message did not ask for is refused. */
export async function anEmailingUpdateNotAskedIsRefused(): Promise<void> {
  const h = harness();
  await h.call(UPDATE_TOOL, { id: ROW, body: { channelId: CHANNEL } });
  expect([h.lastResult(), h.stored]).toEqual([{ ok: false, error: PROPOSE_REPORT_EMAIL_NOT_ASKED_ERROR }, []]);
}

/** Q5: re-enabling a schedule whose stored channel is set, not asked, is refused. */
export async function reEnablingAnEmailingScheduleNotAskedIsRefused(): Promise<void> {
  const h = harness({ storedChannel: true });
  await h.call(UPDATE_TOOL, { id: ROW, body: { enabled: true } });
  expect([h.lastResult(), h.stored]).toEqual([{ ok: false, error: PROPOSE_REPORT_EMAIL_NOT_ASKED_ERROR }, []]);
}

/** Q5: re-enabling a schedule with no stored channel is stored (adjacent control). */
export async function reEnablingASilentScheduleIsStored(): Promise<void> {
  const h = harness({ storedChannel: false });
  await h.call(UPDATE_TOOL, { id: ROW, body: { enabled: true } });
  expect(h.stored.length).toBe(1);
}

/** D4 (positive control): a create without `channelId` the message did not ask for is stored. */
export async function aSilentCreateNotAskedIsStored(): Promise<void> {
  const h = harness();
  await h.call(CREATE_TOOL, { body: CREATE });
  expect(h.stored.length).toBe(1);
}

/** D4: a create with `channelId` the message asked for is stored. */
export async function anEmailingCreateAskedIsStored(): Promise<void> {
  const h = harness();
  await h.call(CREATE_TOOL, { body: EMAILED }, ASKED);
  expect(h.stored.length).toBe(1);
}

/** Q3: the channel test-send switch does not allow report email. */
export async function theTestSendSwitchDoesNotAllowReportEmail(): Promise<void> {
  const h = harness();
  await h.call(CREATE_TOOL, { body: EMAILED }, { outwardIntent: true });
  expect([h.lastResult(), h.stored]).toEqual([{ ok: false, error: PROPOSE_REPORT_EMAIL_NOT_ASKED_ERROR }, []]);
}

/** D5: the stored body carries the card-only recipients, with the address in full. */
export async function theStoredBodyCarriesTheRecipients(): Promise<void> {
  const h = harness();
  await h.call(CREATE_TOOL, { body: EMAILED }, ASKED);
  expect(h.stored[0]?.body).toEqual({ ...EMAILED, recipients: RECIPIENTS });
}

/** D5: the hash leaves the recipients out. */
export async function theHashLeavesTheRecipientsOut(): Promise<void> {
  const h = harness();
  await h.call(CREATE_TOOL, { body: EMAILED }, ASKED);
  expect([h.stored[0]?.bodyHash, hashExcludedKeysFor("reportSchedule.create")]).toEqual([bodyHash(EMAILED), ["recipients"]]);
}

/** D5: the stored summary carries the note and names no address. */
export async function theSummaryCarriesTheNoteAndNoAddress(): Promise<void> {
  const h = harness();
  await h.call(CREATE_TOOL, { body: EMAILED }, ASKED);
  const summary = h.stored[0]?.summary ?? "";
  expect([summary.endsWith(" on every run with no later Confirm."), summary.includes("@")]).toEqual([true, false]);
}

/** A refused check stores nothing and returns the route's sentence. */
export async function aRefusedCheckStoresNothing(): Promise<void> {
  const h = harness({ refusal: "locationIds is outside your access scope" });
  await h.call(CREATE_TOOL, { body: CREATE });
  expect([h.lastResult(), h.stored]).toEqual([{ ok: false, error: "locationIds is outside your access scope" }, []]);
}

/** Tools built without the check fail closed. */
export async function noCheckServiceFailsClosed(): Promise<void> {
  const h = proposeHarness({ target: target() });
  await h.call(SAVE_TOOL, { body: SAVE });
  expect([h.lastResult(), h.stored]).toEqual([{ ok: false, error: PROPOSE_REPORTS_UNAVAILABLE_ERROR }, []]);
}

/** Q14: the save stores no card-only key (it has none, so the browser would send one to the strict route). */
export async function theSaveIsStoredWithoutRecipients(): Promise<void> {
  const h = harness();
  await h.call(SAVE_TOOL, { body: SAVE });
  expect(h.stored[0]?.body).toEqual(SAVE);
}

/** `F4.290`: a save naming sites reaches the report check with them, unchanged. */
export async function aSaveNamingSitesReachesTheCheckUnchanged(): Promise<void> {
  const h = harness();
  await h.call(SAVE_TOOL, { body: { ...SAVE, locationIds: [ROW] } });
  expect(h.c.calls[0]?.body.locationIds).toEqual([ROW]);
}

/** `F4.290`: the stored card body keeps the sites, so the hash binds them and Confirm posts them. */
export async function aSaveNamingSitesIsStoredWithThem(): Promise<void> {
  const h = harness();
  await h.call(SAVE_TOOL, { body: { ...SAVE, locationIds: [ROW] } });
  expect(h.stored[0]?.body).toEqual({ ...SAVE, locationIds: [ROW] });
}

/** Q7: the save's model body requires `organizationId`. */
export async function theSaveWithoutAnOrganizationIsRefused(): Promise<void> {
  const { organizationId: _omitted, ...body } = SAVE;
  const h = harness();
  await h.call(SAVE_TOOL, { body });
  const result = h.lastResult();
  expect([result?.ok === false && result.error.startsWith("Invalid body"), h.stored]).toEqual([true, []]);
}

/** D4: `fill_step` with `channelId` the message did not ask for is refused. */
export async function fillingAChannelNotAskedIsRefused(): Promise<void> {
  const h = harness();
  await h.call(FILL_STEP_TOOL, { catalogId: "reportSchedule.create", params: {}, stepId: "delivery", values: { channelId: CHANNEL } }, OPEN_CREATE);
  expect(h.lastResult()).toEqual({ ok: false, error: PROPOSE_REPORT_EMAIL_NOT_ASKED_ERROR });
}

/** D4: `fill_step` with `channelId` the message asked for is filled. */
export async function fillingAChannelAskedIsFilled(): Promise<void> {
  const h = harness();
  await h.call(
    FILL_STEP_TOOL,
    { catalogId: "reportSchedule.create", params: {}, stepId: "delivery", values: { channelId: CHANNEL } },
    { ...OPEN_CREATE, ...ASKED },
  );
  expect(h.lastResult()?.ok).toBe(true);
}

/** D4 (positive control): `fill_step` without `channelId`, not asked, is filled. */
export async function fillingWithoutAChannelIsFilled(): Promise<void> {
  const h = harness();
  await h.call(FILL_STEP_TOOL, { catalogId: "reportSchedule.create", params: {}, stepId: "scope", values: { locationIds: [] } }, OPEN_CREATE);
  expect(h.lastResult()?.ok).toBe(true);
}

/** Q5: `fill_step` re-enabling a schedule whose stored channel is set, not asked, is refused. */
export async function fillingReEnableOfAnEmailingScheduleIsRefused(): Promise<void> {
  const h = harness({ storedChannel: true });
  await h.call(FILL_STEP_TOOL, { catalogId: "reportSchedule.update", params: { id: ROW }, stepId: "schedule", values: { enabled: true } }, OPEN_UPDATE);
  expect(h.lastResult()).toEqual({ ok: false, error: PROPOSE_REPORT_EMAIL_NOT_ASKED_ERROR });
}

/** The check is asked with the resolved organization, the caller and the path's id. */
export async function theCheckIsAskedWithTheResolvedOrganization(): Promise<void> {
  const h = harness();
  await h.call(UPDATE_TOOL, { id: ROW, body: { name: "Renamed" } }, asRole("location_admin"));
  expect(h.c.calls.map((call) => [call.entryId, call.organizationId, call.params.id])).toEqual([["reportSchedule.update", ORG_X, ROW]]);
}
