import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import type { NotificationChannelRow } from "./notification-transport";
import { FLEET_CHANNEL_REFUSAL, NotificationProposalCheckService } from "./notification-proposal-check.service";

/**
 * `F4.279` (ADR 0099 Amendment 8 D5, Q3, Q13) — the check a notification
 * proposal runs before its card is stored. It reads every channel the proposal
 * names through `ChannelsService.loadById` (the route's own gate), refuses a
 * fleet-wide or another organization's channel, and builds the card-only
 * recipient list (every address and URL in full) and a model-facing note
 * (names and counts only). It writes nothing. Vitest entry point: the sibling
 * `.test.ts`.
 */

type Ctor = ConstructorParameters<typeof NotificationProposalCheckService>;

const ORG = "aaaaaaaa-0000-4000-8000-00000000000a";
const OTHER_ORG = "bbbbbbbb-0000-4000-8000-00000000000b";
const EMAIL = "11111111-0000-4000-8000-000000000001";
const HOOK = "22222222-0000-4000-8000-000000000002";
const FLEET = "33333333-0000-4000-8000-000000000003";
const FOREIGN = "44444444-0000-4000-8000-000000000004";
const PROFILE = "55555555-0000-4000-8000-000000000005";
const URL = "https://hooks.example.test/ops";
const USER = { sub: "u1", email: "admin@bms.local", role: "admin" } as JwtPayload;

function row(id: string, organizationId: string | null, kind: string, config: Record<string, unknown>, name: string): NotificationChannelRow {
  return {
    id,
    organizationId,
    code: name.toLowerCase(),
    name,
    kind,
    config,
    secret: "never-on-a-card",
    secretState: "ready",
    enabled: true,
    updatedAt: new Date(0),
  };
}

const ROWS: Record<string, NotificationChannelRow> = {
  [EMAIL]: row(EMAIL, ORG, "email", { to: ["a@example.test", "b@example.test"] }, "Ops mail"),
  [HOOK]: row(HOOK, ORG, "webhook", { url: URL }, "Ops hook"),
  [FLEET]: row(FLEET, null, "email", { to: ["fleet@example.test"] }, "Fleet mail"),
  [FOREIGN]: row(FOREIGN, OTHER_ORG, "email", { to: ["other@example.test"] }, "Other mail"),
};

/** The rule's current joins, and which of them the route keeps for the caller (`joinsOutsideManageScope`). */
type Joins = { readonly current?: readonly string[]; readonly kept?: readonly string[] };

/** `setRuleChannels`'s read, from `ROWS`: no manage gate, as the route has none. */
function previewFake(joins: Joins = {}): Ctor[2] {
  return {
    previewRuleChannels: async (_jwt: JwtPayload, _ruleId: string, ids: readonly string[]) => {
      const rows = (list: readonly string[]) => list.flatMap((id) => (ROWS[id] === undefined ? [] : [ROWS[id]]));
      const kept = joins.kept ?? [];
      const current = joins.current ?? [];
      return {
        named: rows(ids),
        kept: rows(current.filter((id) => kept.includes(id))),
        removed: rows(current.filter((id) => !ids.includes(id) && !kept.includes(id))),
      };
    },
  } as unknown as Ctor[2];
}

/** A `loadById` that refuses every channel: the manage gate a location or asset-group admin meets. */
const refusingChannels = {
  loadById: async () => {
    throw new ForbiddenException("Notification channel is outside your access scope");
  },
} as unknown as Ctor[0];

/** A channel read that answers from `ROWS`, and any write method that records and throws. */
function fakes(touched: string[] = []): { channels: Ctor[0]; profiles: Ctor[1] } {
  const untouchable = (name: string) => () => {
    touched.push(name);
    throw new Error(`${name} must not be called`);
  };
  const channels = {
    loadById: async (_jwt: JwtPayload, id: string) => ROWS[id] ?? null,
    create: untouchable("channels.create"),
    update: untouchable("channels.update"),
    remove: untouchable("channels.remove"),
    setRuleChannels: untouchable("channels.setRuleChannels"),
  } as unknown as Ctor[0];
  const profiles = {
    list: async () => [
      {
        id: PROFILE,
        organizationId: ORG,
        code: "p1",
        name: "P1",
        steps: [{ stepNo: 1, afterMinutes: 5, channelIds: [EMAIL, HOOK] }],
        createdAt: "",
        updatedAt: "",
      },
    ],
    create: untouchable("profiles.create"),
    update: untouchable("profiles.update"),
    setDefaults: untouchable("profiles.setDefaults"),
  } as unknown as Ctor[1];
  return { channels, profiles };
}

function check(entryId: string, body: Record<string, unknown>, params: Record<string, string> = {}, touched: string[] = []) {
  const { channels, profiles } = fakes(touched);
  return new NotificationProposalCheckService(channels, profiles, previewFake()).check({
    entryId,
    params,
    body,
    organizationId: ORG,
    user: USER,
  });
}

/** A rule channel set checked with a refusing manage gate, as `role`, over the rule's joins. */
function checkRuleSet(channelIds: string[], role: string, joins: Joins = {}, channels: Ctor[0] = refusingChannels) {
  return new NotificationProposalCheckService(channels, fakes().profiles, previewFake(joins)).check({
    entryId: "rule.notifications.set",
    params: { id: "r" },
    body: { channelIds },
    organizationId: ORG,
    user: { ...USER, role } as JwtPayload,
  });
}

async function refusal(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  return undefined;
}

/** Q3: a fleet-wide channel on a rule is refused with the page's sentence. */
export async function aFleetWideChannelIsRefused(): Promise<void> {
  const err = await refusal(() => check("rule.notifications.set", { channelIds: [EMAIL, FLEET] }, { id: "r" }));
  expect([err instanceof BadRequestException, (err as Error).message]).toEqual([true, FLEET_CHANNEL_REFUSAL]);
}

/** A channel of another organization is refused with the pairing sentence, naming the channel. */
export async function aCrossOrganizationChannelIsRefused(): Promise<void> {
  const err = await refusal(() => check("escalationProfile.create", { steps: [{ afterMinutes: 5, channelIds: [FOREIGN] }] }));
  expect((err as Error).message).toContain(FOREIGN);
}

/** A channel the caller may not manage is the route's own refusal (`loadById`'s 403). */
export async function aChannelOutsideTheScopeIsTheRoutesRefusal(): Promise<void> {
  const { profiles } = fakes();
  const channels = {
    loadById: async () => {
      throw new ForbiddenException("Notification channel is outside your access scope");
    },
  } as unknown as Ctor[0];
  const err = await refusal(() =>
    new NotificationProposalCheckService(channels, profiles, previewFake()).check({
      entryId: "notificationChannel.test",
      params: { id: EMAIL },
      body: {},
      organizationId: ORG,
      user: USER,
    }),
  );
  expect(err).toBeInstanceOf(ForbiddenException);
}

/** D5: an email channel's recipients carry every address in full. */
export async function anEmailChannelsRecipientsAreInFull(): Promise<void> {
  const result = await check("notificationChannel.test", {}, { id: EMAIL });
  expect(result.recipients).toEqual([
    { channelId: EMAIL, name: "Ops mail", kind: "email", targets: ["a@example.test", "b@example.test"] },
  ]);
}

/** D5: a webhook's recipient is its URL in full. */
export async function aWebhooksRecipientIsItsUrl(): Promise<void> {
  const result = await check("notificationChannel.deactivate", { enabled: false }, { id: HOOK });
  expect(result.recipients[0]?.targets).toEqual([URL]);
}

/** D5: the note carries counts only — no address, no URL. */
export async function theNoteNamesNoAddress(): Promise<void> {
  const result = await check("rule.notifications.set", { channelIds: [EMAIL, HOOK] }, { id: "r" });
  expect([result.note.includes("@"), result.note.includes(URL), result.note]).toEqual([false, false, "Channels: 2; recipients: 3."]);
}

/** A webhook create shows the URL as typed on Confirm (Q12). */
export async function aWebhookCreateShowsTheUrlAsTypedOnConfirm(): Promise<void> {
  const result = await check("notificationChannel.create", { organizationId: ORG, code: "h", name: "Hook", kind: "webhook" });
  expect(result.recipients).toEqual([{ channelId: null, name: "Hook", kind: "webhook", targets: ["(typed on Confirm)"] }]);
}

/** The severity map reaches the channels of the profiles it maps. */
export async function theSeverityMapReachesItsProfilesChannels(): Promise<void> {
  const result = await check("escalationDefaults.set", { organizationId: ORG, items: [{ severity: "critical", profileId: PROFILE }] });
  expect(result.recipients.map((r) => r.channelId)).toEqual([EMAIL, HOOK]);
}

/** A profile the organization does not hold is refused with the route's sentence. */
export async function anUnknownProfileIsRefused(): Promise<void> {
  const missing = "66666666-0000-4000-8000-000000000006";
  const err = await refusal(() => check("escalationDefaults.set", { organizationId: ORG, items: [{ severity: "critical", profileId: missing }] }));
  expect((err as Error).message).toContain(missing);
}

/** The check writes nothing: no write method of either service is called. */
export async function theCheckWritesNothing(): Promise<void> {
  const touched: string[] = [];
  await check("rule.notifications.set", { channelIds: [EMAIL, HOOK] }, { id: "r" }, touched);
  await check("escalationDefaults.set", { organizationId: ORG, items: [{ severity: "critical", profileId: PROFILE }] }, {}, touched);
  await check("notificationChannel.test", {}, { id: EMAIL }, touched);
  expect(touched).toEqual([]);
}

/** The positive control for the write-free claim: the fake does record a write call. */
export async function theUntouchableFakeRecordsAWrite(): Promise<void> {
  const touched: string[] = [];
  const { channels } = fakes(touched);
  expect(() => (channels as unknown as { create: () => void }).create()).toThrow();
  expect(touched).toEqual(["channels.create"]);
}

/** D2 (review): a location admin's rule channel set is not refused by a manage gate the route does not have. */
export async function aLocationAdminsRuleChannelSetPasses(): Promise<void> {
  const result = await checkRuleSet([EMAIL], "location_admin");
  expect(result.recipients.map((r) => r.channelId)).toEqual([EMAIL]);
}

/** D2 (review): an asset-group admin's rule channel set is not refused by a manage gate the route does not have. */
export async function anAssetGroupAdminsRuleChannelSetPasses(): Promise<void> {
  const result = await checkRuleSet([EMAIL], "asset_group_admin");
  expect(result.recipients.map((r) => r.channelId)).toEqual([EMAIL]);
}

/** Q3 (review): an organization admin naming a fleet-wide channel meets Q3's sentence, not a 403. */
export async function anOrganizationAdminNamingAFleetChannelMeetsQ3(): Promise<void> {
  const err = await refusal(() => checkRuleSet([FLEET], "organization_admin"));
  expect([err instanceof BadRequestException, (err as Error).message]).toEqual([true, FLEET_CHANNEL_REFUSAL]);
}

/** Q3 (review): a set that would drop a fleet-wide join (the global admin's full replace) is refused. */
export async function droppingAFleetJoinIsRefused(): Promise<void> {
  const err = await refusal(() => checkRuleSet([EMAIL], "admin", { current: [FLEET, EMAIL] }));
  expect([err instanceof BadRequestException, (err as Error).message]).toEqual([true, FLEET_CHANNEL_REFUSAL]);
}

/** The positive control: the same set, with the fleet join kept by the route, passes. */
export async function aKeptFleetJoinIsNotRefused(): Promise<void> {
  const result = await checkRuleSet([EMAIL], "organization_admin", { current: [FLEET, EMAIL], kept: [FLEET] });
  expect(result.recipients.map((r) => r.channelId)).toEqual([EMAIL, FLEET]);
}

/** D5 (review): a join the route keeps is on the card, marked `kept`. */
export async function aKeptJoinIsListedAsKept(): Promise<void> {
  const result = await checkRuleSet([], "organization_admin", { current: [FLEET], kept: [FLEET] });
  expect(result.recipients).toEqual([
    { channelId: FLEET, name: "Fleet mail", kind: "email", targets: ["fleet@example.test"], kept: true },
  ]);
}

/** D5 (review): an empty set with a kept join does not say the rule notifies nobody. */
export async function anEmptySetWithAKeptJoinMakesNoNobodyClaim(): Promise<void> {
  const result = await checkRuleSet([], "organization_admin", { current: [FLEET], kept: [FLEET] });
  expect(result.note).toBe("Kept outside your scope: 1 channel.");
}

/** D5 (review): an empty set with nothing kept says the rule then notifies nobody. */
export async function anEmptySetWithNothingKeptSaysNobody(): Promise<void> {
  const result = await checkRuleSet([], "admin", { current: [EMAIL] });
  expect(result.note).toBe("The rule then notifies nobody.");
}
