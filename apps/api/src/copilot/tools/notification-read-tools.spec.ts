import { ForbiddenException } from "@nestjs/common";
import { expect } from "vitest";

import type { EscalationProfileDto, JwtPayload, NotificationChannelDto } from "@bms/shared";

import type { ResolvedIdentity } from "../../auth/identity-resolver";
import type { CopilotToolContext, CopilotToolResult } from "../copilot-read-tools";
import type { CopilotReadServices } from "./copilot-read-tool";
import { createCopilotReadTools } from "./copilot-read-tool-set";
import { organizationOutOfScope } from "./copilot-tool-scope";
import { COPILOT_NOTIFICATIONS_ROLE_REFUSAL } from "./list-notification-channels.tool";

/**
 * `F4.279` (ADR 0099 Amendment 8 D7, D5, Q9, Q13) — `list_notification_channels`
 * and `list_escalation_profiles` over fakes of `ChannelsService.list` and
 * `EscalationProfilesService.list` / `getDefaults` that log their calls. The
 * model looks ids up and never sees an address or a URL. Vitest entry point:
 * the sibling `.test.ts`.
 */

const USER = "11111111-1111-4111-8111-111111111111";
const ORG_X = "00000000-0000-4000-8000-0000000000aa";
const ORG_Y = "00000000-0000-4000-8000-0000000000bb";
const ORG_B = "00000000-0000-4000-8000-0000000000cc";
const ADDRESS = "ops@example.test";
const URL = "https://hooks.example.test/secret-path";

function ctx(allowed: readonly string[], role: ResolvedIdentity["role"] = "admin"): CopilotToolContext {
  return {
    identity: { id: USER, role, organizationId: null } as ResolvedIdentity,
    user: { sub: USER, role } as JwtPayload,
    conversationId: "22222222-2222-4222-8222-222222222222",
    conversationOrganizationId: null,
    allowedOrganizationIds: allowed,
    turnKind: "user",
    now: new Date("2026-10-24T06:00:00Z"),
  };
}

function channel(index: number, organizationId: string | null, over: Partial<NotificationChannelDto> = {}): NotificationChannelDto {
  const n = String(index).padStart(2, "0");
  return {
    id: `channel-${n}`,
    organizationId,
    code: `ch-${n}`,
    name: `Channel ${n}`,
    kind: "email",
    config: { to: [ADDRESS, `b${n}@example.test`] },
    enabled: true,
    hasSecret: false,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...over,
  };
}

function profile(index: number, organizationId: string): EscalationProfileDto {
  return {
    id: `profile-${index}`,
    organizationId,
    code: `p${index}`,
    name: `Profile ${index}`,
    steps: [{ stepNo: 1, afterMinutes: 5, channelIds: ["channel-01"] }],
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

function fake(channels: NotificationChannelDto[], profiles: EscalationProfileDto[] = []) {
  const log: string[] = [];
  const services = {
    channels: {
      list: async () => {
        log.push("channels.list");
        return channels;
      },
    },
    escalationProfiles: {
      list: async () => {
        log.push("profiles.list");
        return profiles;
      },
      getDefaults: async (_user: JwtPayload, organizationId?: string) => {
        log.push(`profiles.getDefaults:${organizationId}`);
        if (organizationId === ORG_Y) throw new ForbiddenException("Organization is outside your access scope");
        return { organizationId, items: [{ severity: "critical", profileId: "profile-1", profileCode: "p1" }] };
      },
    },
  } as unknown as CopilotReadServices;
  return { tools: createCopilotReadTools(services), log };
}

type Listed = {
  organizations: { organizationId: string; items: Record<string, unknown>[]; defaults?: unknown[] }[];
  truncated: boolean;
};

async function list(tools: ReturnType<typeof fake>["tools"], name: string, args: Record<string, unknown>, c: CopilotToolContext) {
  const result: CopilotToolResult = await tools.dispatch(name, args, c);
  if (!result.ok) throw new Error(result.error);
  return result.result as unknown as Listed;
}

const itemsOf = (listed: Listed) => listed.organizations.flatMap((entry) => entry.items);

/** An `asset_group_admin` is refused before the service. */
export async function anAssetGroupAdminIsRefusedBeforeTheService(): Promise<void> {
  const { tools, log } = fake([channel(1, ORG_X)]);
  const result = await tools.dispatch("list_notification_channels", {}, ctx([ORG_X], "asset_group_admin"));
  expect([result, log]).toEqual([{ ok: false, error: COPILOT_NOTIFICATIONS_ROLE_REFUSAL }, []]);
}

/** A `location_admin` is refused before the service (the route answers it `[]`). */
export async function aLocationAdminIsRefusedBeforeTheService(): Promise<void> {
  const { tools, log } = fake([], [profile(1, ORG_X)]);
  const result = await tools.dispatch("list_escalation_profiles", {}, ctx([ORG_X], "location_admin"));
  expect([result, log]).toEqual([{ ok: false, error: COPILOT_NOTIFICATIONS_ROLE_REFUSAL }, []]);
}

/** An organization outside the allowed set is refused, and the service is not called. */
export async function anOrganizationOutsideTheAllowedSetIsRefused(): Promise<void> {
  const { tools, log } = fake([channel(1, ORG_X)]);
  const result = await tools.dispatch("list_notification_channels", { organizationId: ORG_B }, ctx([ORG_X]));
  expect([result, log]).toEqual([{ ok: false, error: organizationOutOfScope([ORG_X]) }, []]);
}

/** Q13: a fleet-wide channel is dropped. */
export async function aFleetWideChannelIsDropped(): Promise<void> {
  const { tools } = fake([channel(1, ORG_X), channel(2, null)]);
  expect(itemsOf(await list(tools, "list_notification_channels", {}, ctx([ORG_X]))).map((item) => item.id)).toEqual(["channel-01"]);
}

/** A channel of an organization outside the allowed set is dropped. */
export async function aChannelOfAnotherOrganizationIsDropped(): Promise<void> {
  const { tools } = fake([channel(1, ORG_X), channel(2, ORG_B)]);
  expect(itemsOf(await list(tools, "list_notification_channels", {}, ctx([ORG_X]))).map((item) => item.id)).toEqual(["channel-01"]);
}

/** D5, D7: a row carries the counts. */
export async function aChannelRowCarriesTheCounts(): Promise<void> {
  const { tools } = fake([channel(1, ORG_X), channel(2, ORG_X, { kind: "webhook", config: { url: URL }, hasSecret: true })]);
  const items = itemsOf(await list(tools, "list_notification_channels", {}, ctx([ORG_X])));
  expect(items.map((item) => [item.kind, item.recipientCount, item.hasUrl, item.hasSecret])).toEqual([
    ["email", 2, false, false],
    ["webhook", 0, true, true],
  ]);
}

/** D5, D7: the result never carries an address or a URL. */
export async function theResultCarriesNoAddressAndNoUrl(): Promise<void> {
  const { tools } = fake([channel(1, ORG_X), channel(2, ORG_X, { kind: "webhook", config: { url: URL } })]);
  const text = JSON.stringify(await list(tools, "list_notification_channels", {}, ctx([ORG_X])));
  expect([text.includes(ADDRESS), text.includes("https://"), text.includes("config")]).toEqual([false, false, false]);
}

/** Forty rows are cut to the 25-item cap and marked truncated. */
export async function fortyRowsAreCutToTheCap(): Promise<void> {
  const { tools } = fake(Array.from({ length: 40 }, (_, index) => channel(index + 1, ORG_X)));
  const listed = await list(tools, "list_notification_channels", {}, ctx([ORG_X]));
  expect([itemsOf(listed).length, listed.truncated]).toEqual([25, true]);
}

/** `search` narrows by code or name before the cap. */
export async function searchNarrowsBeforeTheCap(): Promise<void> {
  const { tools } = fake([...Array.from({ length: 30 }, (_, index) => channel(index + 1, ORG_X)), channel(99, ORG_X, { name: "Night desk" })]);
  const listed = await list(tools, "list_notification_channels", { search: "night" }, ctx([ORG_X]));
  expect([itemsOf(listed).map((item) => item.id), listed.truncated]).toEqual([["channel-99"], false]);
}

/** The service is called once, whatever the organizations. */
export async function theChannelServiceIsCalledOnce(): Promise<void> {
  const { tools, log } = fake([channel(1, ORG_X), channel(2, ORG_Y)]);
  await list(tools, "list_notification_channels", {}, ctx([ORG_X, ORG_Y]));
  expect(log).toEqual(["channels.list"]);
}

/** The profiles tool returns each ladder with its channel ids. */
export async function theProfilesToolReturnsTheLadders(): Promise<void> {
  const { tools } = fake([], [profile(1, ORG_X), profile(2, ORG_B)]);
  const items = itemsOf(await list(tools, "list_escalation_profiles", {}, ctx([ORG_X])));
  expect(items).toEqual([{ id: "profile-1", code: "p1", name: "Profile 1", steps: [{ stepNo: 1, afterMinutes: 5, channelIds: ["channel-01"] }] }]);
}

/** Q9: the profiles tool returns each organization's severity map beside its profiles. */
export async function theProfilesToolReturnsTheSeverityMap(): Promise<void> {
  const { tools } = fake([], [profile(1, ORG_X)]);
  const listed = await list(tools, "list_escalation_profiles", {}, ctx([ORG_X]));
  expect(listed.organizations[0]?.defaults).toEqual([{ severity: "critical", profileId: "profile-1", profileCode: "p1" }]);
}

/** Q9: an organization whose map the caller may not read is listed without one; the read is not refused whole. */
export async function aMapTheCallerMayNotReadIsLeftOut(): Promise<void> {
  const { tools, log } = fake([], [profile(1, ORG_X)]);
  const listed = await list(tools, "list_escalation_profiles", {}, ctx([ORG_X, ORG_Y]));
  expect([listed.organizations.map((entry) => [entry.organizationId, entry.defaults === undefined]), log]).toEqual([
    [
      [ORG_X, false],
      [ORG_Y, true],
    ],
    ["profiles.list", `profiles.getDefaults:${ORG_X}`, `profiles.getDefaults:${ORG_Y}`],
  ]);
}
