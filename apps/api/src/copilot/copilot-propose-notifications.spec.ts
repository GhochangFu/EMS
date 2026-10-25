import { BadRequestException } from "@nestjs/common";
import { expect } from "vitest";

import { proposeToolName, withPaths } from "@bms/shared/copilot";

import type { ResolvedIdentity } from "../auth/identity-resolver";
import type { NotificationProposalCheckInput } from "../notifications/notification-proposal-check.service";
import { bodyHash } from "./body-hash";
import { PROPOSE_OUTWARD_NOT_ASKED_ERROR, PROPOSE_OUTWARD_ON_FOLLOW_UP_ERROR } from "./copilot-outward-intent";
import { NOTIFICATION_ENTRY_IDS, PROPOSE_NOTIFICATIONS_UNAVAILABLE_ERROR } from "./copilot-propose-notifications";
import { FILL_STEP_TOOL, PROPOSE_PRECONDITION_ERROR } from "./copilot-propose-tools";
import { proposeHarness, STAMP } from "./copilot-propose-tools.spec";
import type { ResolvedTarget } from "./copilot-target-resolver";

/**
 * `F4.279` (ADR 0099 Amendment 8, D2, D4–D6, Q11–Q13) — the propose tools over
 * the real notification entries, with a recording fake of
 * `NotificationProposalCheckService`. Vitest entry point: the sibling `.test.ts`.
 */

const ORG_X = "00000000-0000-4000-8000-0000000000aa";
const USER = "11111111-1111-4111-8111-111111111111";
const ROW = "44444444-4444-4444-8444-444444444444";
const ADDRESS = "ops@example.test";
const RECIPIENTS = [{ channelId: ROW, name: "Ops", kind: "email", targets: [ADDRESS] }];

const TEST_TOOL = proposeToolName({ id: "notificationChannel.test" });
const CREATE_TOOL = proposeToolName({ id: "notificationChannel.create" });
const RULE_SET_TOOL = proposeToolName({ id: "rule.notifications.set" });
const PROFILE_UPDATE_TOOL = proposeToolName({ id: "escalationProfile.update" });
const NOTIFICATION_TOOLS = [...NOTIFICATION_ENTRY_IDS].map((id) => proposeToolName({ id }));
const CHANNEL_ADMIN_TOOLS = NOTIFICATION_TOOLS.filter((name) => name !== RULE_SET_TOOL);

const UPDATE_TOOL = proposeToolName({ id: "notificationChannel.update" });
const HOOK_URL = "https://hooks.example.test/ops";
const CHANNEL_HASH_EXCLUDED = ["secret", "config.url", "recipients"];
const OPEN_CREATE = { openWizards: [{ catalogId: "notificationChannel.create", params: {}, name: null, organizationId: null }] };

const EMAIL_CREATE = { organizationId: ORG_X, code: "ops", name: "Ops", kind: "email", config: { to: [ADDRESS] } };

const target = (over: Partial<ResolvedTarget> = {}): ResolvedTarget => ({
  organizationId: ORG_X,
  organizationName: "Org X",
  targetName: "Ops",
  ...over,
});

function checks(refusal?: string) {
  const calls: NotificationProposalCheckInput[] = [];
  return {
    calls,
    fake: {
      check: async (input: NotificationProposalCheckInput) => {
        calls.push(input);
        if (refusal !== undefined) throw new BadRequestException(refusal);
        return { note: "Recipients: 1.", recipients: RECIPIENTS };
      },
    },
  };
}

function harness(over: { target?: ResolvedTarget | null; refusal?: string } = {}) {
  const c = checks(over.refusal);
  const h = proposeHarness({ target: over.target === undefined ? target() : over.target, notifications: c.fake });
  return { ...h, c };
}

const asRole = (role: string) => ({ identity: { id: USER, role, organizationId: ORG_X } as ResolvedIdentity });

function namesFor(role: string, outward = true): string[] {
  return harness().tools.registryFor({ access: false, role, outward }).definitions.map((d) => d.name);
}

/** The channel and escalation tools are in the global admin's registry. */
export function theAdminRegistryHasEveryNotificationTool(): void {
  expect(namesFor("admin")).toEqual(expect.arrayContaining(NOTIFICATION_TOOLS));
}

/** The channel and escalation tools are in an organization admin's registry. */
export function theOrganizationAdminRegistryHasEveryNotificationTool(): void {
  expect(namesFor("organization_admin")).toEqual(expect.arrayContaining(NOTIFICATION_TOOLS));
}

/** A location admin is offered the rule channel set and no channel or escalation tool. */
export function aLocationAdminIsOfferedOnlyTheRuleChannelSet(): void {
  const names = namesFor("location_admin");
  expect([names.includes(RULE_SET_TOOL), CHANNEL_ADMIN_TOOLS.filter((name) => names.includes(name))]).toEqual([true, []]);
}

/** An asset-group admin is offered the rule channel set and no channel or escalation tool. */
export function anAssetGroupAdminIsOfferedOnlyTheRuleChannelSet(): void {
  const names = namesFor("asset_group_admin");
  expect([names.includes(RULE_SET_TOOL), CHANNEL_ADMIN_TOOLS.filter((name) => names.includes(name))]).toEqual([true, []]);
}

/** D4: a registry built without the outward switch has no test tool. */
export function aRegistryWithoutOutwardHasNoTestTool(): void {
  expect(namesFor("admin", false)).not.toContain(TEST_TOOL);
}

/** D4: with the switch on, the test tool is there. */
export function aRegistryWithOutwardHasTheTestTool(): void {
  expect(namesFor("admin", true)).toContain(TEST_TOOL);
}

/** D4: absent is `false` — the registry fails closed. */
export function anAbsentOutwardSwitchHasNoTestTool(): void {
  expect(harness().tools.registryFor({ access: false, role: "admin" }).definitions.map((d) => d.name)).not.toContain(TEST_TOOL);
}

/** D4, decision 4.7: a follow-up turn never proposes the test send. */
export async function aTestInAFollowUpTurnIsRefused(): Promise<void> {
  const h = harness();
  await h.call(TEST_TOOL, { id: ROW }, { turnKind: "follow_up", outwardIntent: true });
  expect([h.lastResult(), h.stored]).toEqual([{ ok: false, error: PROPOSE_OUTWARD_ON_FOLLOW_UP_ERROR }, []]);
}

/** D4: a user turn whose own message did not ask is refused (the second guard behind the registry). */
export async function aTestTheMessageDidNotAskForIsRefused(): Promise<void> {
  const h = harness();
  await h.call(TEST_TOOL, { id: ROW });
  expect([h.lastResult(), h.stored]).toEqual([{ ok: false, error: PROPOSE_OUTWARD_NOT_ASKED_ERROR }, []]);
}

/** D4: a user turn that asked stores the red test card. */
export async function aTestTheMessageAskedForIsStored(): Promise<void> {
  const h = harness();
  await h.call(TEST_TOOL, { id: ROW }, { outwardIntent: true });
  expect([h.stored.length, h.stored[0]?.risk]).toEqual([1, "deactivate"]);
}

/** A refused check stores nothing and returns the route's sentence. */
export async function aRefusedCheckStoresNothing(): Promise<void> {
  const h = harness({ refusal: "Fleet-wide channels are managed on the Channels page" });
  await h.call(RULE_SET_TOOL, { id: ROW, body: { channelIds: [ROW] } });
  expect([h.lastResult(), h.stored]).toEqual([{ ok: false, error: "Fleet-wide channels are managed on the Channels page" }, []]);
}

/** Tools built without the check fail closed. */
export async function noCheckServiceFailsClosed(): Promise<void> {
  const h = proposeHarness({ target: target() });
  await h.call(RULE_SET_TOOL, { id: ROW, body: { channelIds: [ROW] } });
  expect([h.lastResult(), h.stored]).toEqual([{ ok: false, error: PROPOSE_NOTIFICATIONS_UNAVAILABLE_ERROR }, []]);
}

/** D5: the stored body carries the card-only recipients. */
export async function theStoredBodyCarriesTheRecipients(): Promise<void> {
  const h = harness();
  await h.call(RULE_SET_TOOL, { id: ROW, body: { channelIds: [ROW] } });
  expect(h.stored[0]?.body).toEqual({ channelIds: [ROW], recipients: RECIPIENTS });
}

/** The hash leaves the recipients out. */
export async function theHashLeavesTheRecipientsOut(): Promise<void> {
  const h = harness();
  await h.call(RULE_SET_TOOL, { id: ROW, body: { channelIds: [ROW] } });
  expect(h.stored[0]?.bodyHash).toBe(bodyHash({ channelIds: [ROW] }));
}

/** A channel entry's hash leaves out the secret, the URL path and the recipients. */
export async function aChannelHashLeavesOutTheClientOnlyPathsAndRecipients(): Promise<void> {
  const h = harness();
  await h.call(CREATE_TOOL, { body: EMAIL_CREATE });
  expect(h.stored[0]?.bodyHash).toBe(bodyHash(h.stored[0]?.body, ["secret", "config.url", "recipients"]));
}

/** D5: the stored summary carries the note and names no address. */
export async function theSummaryCarriesTheNoteAndNoAddress(): Promise<void> {
  const h = harness();
  await h.call(CREATE_TOOL, { body: EMAIL_CREATE });
  const summary = h.stored[0]?.summary ?? "";
  expect([summary.endsWith(" Recipients: 1."), summary.includes("@")]).toEqual([true, false]);
}

/** D5: the update's summary lists the body's fields, never the card-only key. */
export async function theUpdateSummaryNeverListsTheRecipients(): Promise<void> {
  const h = harness();
  await h.call(proposeToolName({ id: "notificationChannel.update" }), { id: ROW, body: { name: "Ops desk" } });
  expect(h.stored[0]?.summary).toBe('Change name of the channel "Ops". Recipients: 1.');
}

/**
 * Q11: a create that carries a secret is refused (the turn's credential guard, or the strict model
 * body behind it) and stores nothing.
 */
export async function aCreateWithASecretIsRefused(): Promise<void> {
  const h = harness();
  const outcome = await h.call(CREATE_TOOL, { body: { ...EMAIL_CREATE, secret: "s3cret-value" } });
  expect([outcome.ok, h.stored]).toEqual([false, []]);
}

/** Q12: a create that carries a URL is refused by the model body. */
export async function aCreateWithAUrlIsRefused(): Promise<void> {
  const h = harness();
  const outcome = await h.call(CREATE_TOOL, {
    body: { ...EMAIL_CREATE, kind: "webhook", config: { url: "https://hooks.example.test/x" } },
  });
  expect([outcome.ok, h.stored]).toEqual([false, []]);
}

/** Q11: `describe_change` of the create names no secret. */
export async function describeChangeNamesNoSecret(): Promise<void> {
  const h = harness();
  await h.call("describe_change", { catalogId: "notificationChannel.create" });
  expect(JSON.stringify(h.lastResult())).not.toContain("secret");
}

/** Q12: the create's config outline names no URL. */
export async function theConfigOutlineNamesNoUrl(): Promise<void> {
  const h = harness();
  await h.call("describe_change", { catalogId: "notificationChannel.create", path: ["config"] });
  const text = JSON.stringify(h.lastResult());
  expect([text.includes('\\"to\\"') || text.includes('"to"'), text.includes("url")]).toEqual([true, false]);
}

/** D6: the profile update stores the resolver's `updatedAt` as its precondition. */
export async function theProfileUpdateStoresItsPrecondition(): Promise<void> {
  const h = harness({ target: target({ updatedAt: STAMP }) });
  await h.call(PROFILE_UPDATE_TOOL, { id: ROW, body: { name: "P1 renamed" } });
  expect(h.stored[0]?.precondition).toBe(STAMP);
}

/** D6: without a stamp the profile update is refused, never stored unguarded. */
export async function theProfileUpdateWithoutAStampIsRefused(): Promise<void> {
  const h = harness({ target: target() });
  await h.call(PROFILE_UPDATE_TOOL, { id: ROW, body: { name: "P1 renamed" } });
  expect([h.lastResult(), h.stored]).toEqual([{ ok: false, error: PROPOSE_PRECONDITION_ERROR }, []]);
}

/** The check is asked with the resolved organization and the caller. */
export async function theCheckIsAskedWithTheResolvedOrganization(): Promise<void> {
  const h = harness();
  await h.call(RULE_SET_TOOL, { id: ROW, body: { channelIds: [ROW] } }, asRole("organization_admin"));
  expect(h.c.calls.map((call) => [call.entryId, call.organizationId, call.params.id])).toEqual([["rule.notifications.set", ORG_X, ROW]]);
}

/** What the browser sends on Confirm: the stored body without its card-only keys, with the typed paths set. */
function confirmedBody(stored: unknown, typed: Record<string, string>): unknown {
  const { recipients: _recipients, ...sent } = stored as Record<string, unknown>;
  return withPaths(sent, typed);
}

/**
 * Review: a webhook create the model sent without `config` stores the defaulted parent, so the
 * Confirm that types `config.url` into it hashes to the stored hash.
 */
export async function aWebhookCreateWithoutConfigConfirmsWithItsUrl(): Promise<void> {
  const h = harness();
  await h.call(CREATE_TOOL, { body: { organizationId: ORG_X, code: "hook", name: "Hook", kind: "webhook" } });
  const stored = h.stored[0];
  expect(bodyHash(confirmedBody(stored?.body, { "config.url": HOOK_URL }), CHANNEL_HASH_EXCLUDED)).toBe(stored?.bodyHash);
}

/** Review: the defaulted parent is the empty object the card writes the URL into. */
export async function aWebhookCreateWithoutConfigStoresTheEmptyConfig(): Promise<void> {
  const h = harness();
  await h.call(CREATE_TOOL, { body: { organizationId: ORG_X, code: "hook", name: "Hook", kind: "webhook" } });
  expect((h.stored[0]?.body as Record<string, unknown>).config).toEqual({});
}

/** Review: an update the model sent without `config` stores none, so the PATCH keeps the stored one. */
export async function anUpdateWithoutConfigStoresNoConfig(): Promise<void> {
  const h = harness();
  await h.call(UPDATE_TOOL, { id: ROW, body: { name: "Ops desk" } });
  expect(Object.keys(h.stored[0]?.body ?? {}).sort()).toEqual(["name", "recipients"]);
}

/** Review: a kind change without its `config` is refused (it would leave an email list on a webhook). */
export async function aKindChangeWithoutConfigIsRefused(): Promise<void> {
  const h = harness();
  const outcome = await h.call(UPDATE_TOOL, { id: ROW, body: { kind: "webhook" } });
  expect([outcome.ok, h.stored]).toEqual([false, []]);
}

/** The positive control: the same kind change with its (empty) `config` is stored. */
export async function aKindChangeWithConfigIsStored(): Promise<void> {
  const h = harness();
  await h.call(UPDATE_TOOL, { id: ROW, body: { kind: "webhook", config: {} } });
  expect(h.stored.length).toBe(1);
}

/** Review (Q6, Q12): `fill_step` cannot put a webhook URL into a channel's `config`. */
export async function fillStepRefusesAUrlInConfig(): Promise<void> {
  const h = harness();
  const outcome = await h.call(
    FILL_STEP_TOOL,
    { catalogId: "notificationChannel.create", params: {}, stepId: "delivery", values: { config: { url: HOOK_URL } } },
    OPEN_CREATE,
  );
  expect(outcome.ok).toBe(false);
}

/** Review (Q6): `fill_step` cannot name a kind the copilot does not propose. */
export async function fillStepRefusesAnUnproposedKind(): Promise<void> {
  const h = harness();
  const outcome = await h.call(
    FILL_STEP_TOOL,
    { catalogId: "notificationChannel.create", params: {}, stepId: "channel", values: { kind: "sms" } },
    OPEN_CREATE,
  );
  expect(outcome.ok).toBe(false);
}

/** The positive control: `fill_step` fills an email recipient list. */
export async function fillStepFillsAnEmailList(): Promise<void> {
  const h = harness();
  const outcome = await h.call(
    FILL_STEP_TOOL,
    { catalogId: "notificationChannel.create", params: {}, stepId: "delivery", values: { config: { to: [ADDRESS] } } },
    OPEN_CREATE,
  );
  expect(outcome.ok).toBe(true);
}

/** Every `items` node under a JSON schema that is an array (a tuple), by path. */
function arrayItemsPaths(node: unknown, path: string): string[] {
  if (Array.isArray(node)) return node.flatMap((item, index) => arrayItemsPaths(item, `${path}[${index}]`));
  if (node === null || typeof node !== "object") return [];
  return Object.entries(node).flatMap(([key, value]) => [
    ...(key === "items" && Array.isArray(value) ? [`${path}.items`] : []),
    ...arrayItemsPaths(value, `${path}.${key}`),
  ]);
}

/**
 * Review: no propose-tool definition holds an array-valued `items` — JSON Schema 2020-12, which the
 * providers validate tool input schemas against, requires `items` to be a schema.
 */
export function noToolDefinitionHoldsATupleItems(): void {
  const definitions = harness().tools.registry.definitions;
  expect(definitions.flatMap((d) => arrayItemsPaths(d, d.name))).toEqual([]);
}
