import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";
import { catalogEntry } from "@bms/shared/copilot";

import { CopilotTargetResolver } from "./copilot-target-resolver";

/**
 * `F4.279` (ADR 0099 Amendment 8 D2) — the `notificationChannel` and
 * `escalationProfile` targets, and `organization` with `manage: "notification"`.
 * Each mirrors the routes' own gate, exactly `ChannelsService.loadById`'s and
 * `EscalationProfilesService`'s: `requireMasterDataUser` (it refuses an
 * `asset_group_admin` with a 403), then `canManageNotificationChannel` on the
 * row's (or the body's) organization, which admits `admin` and an
 * `organization_admin` of that organization only. Vitest entry point: the
 * sibling `.test.ts`.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const ROW = "22222222-2222-4222-8222-222222222222";
const JWT = { sub: "f4279-resolver-unit", role: "admin" } as JwtPayload;
const STAMP = new Date("2026-10-01T08:00:00.000Z");

/**
 * A database whose every `select … limit` answers one row holding only the
 * columns that select named, and whose transaction runs the callback on itself.
 */
function oneRowDb(row: Record<string, unknown>): never {
  let selected: string[] = [];
  const chain = {
    select: (columns: Record<string, unknown> = {}) => {
      selected = Object.keys(columns);
      return chain;
    },
    from: () => chain,
    where: () => chain,
    innerJoin: () => chain,
    limit: async () => [Object.fromEntries(selected.map((key) => [key, row[key]]))],
    execute: async () => undefined,
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(chain),
  };
  return chain as never;
}

/** The two calls the routes make, answered for a role and whether it manages the organization. */
function notificationAccess(role: string, managesOrganization: boolean, asked: string[] = []): never {
  return {
    requireMasterDataUser: async () => {
      asked.push("requireMasterDataUser");
      if (role === "asset_group_admin") throw new Error("403");
      return { id: "u1", role };
    },
    canManageNotificationChannel: async (_user: unknown, organizationId: string | null) => {
      asked.push(`canManageNotificationChannel:${organizationId}`);
      if (organizationId === null) return role === "admin";
      if (role === "admin") return true;
      return role === "organization_admin" && managesOrganization;
    },
  } as never;
}

async function resolveAs(
  id: string,
  role: string,
  managesOrganization = true,
  options: { body?: Record<string, unknown>; asked?: string[] } = {},
) {
  const resolver = new CopilotTargetResolver(
    oneRowDb({ name: "Ops", kind: "email", organizationId: ORG, updatedAt: STAMP }),
    notificationAccess(role, managesOrganization, options.asked),
    {} as never,
    {} as never,
  );
  const entry = catalogEntry(id)!;
  const params: Record<string, string> = entry.path.includes(":id") ? { id: ROW } : {};
  return resolver.resolve(entry, params, options.body ?? { organizationId: ORG }, [ORG], JWT, ORG);
}

const ROW_ENTRIES = ["notificationChannel.update", "notificationChannel.test", "escalationProfile.update"];
const CREATE_ENTRIES = ["notificationChannel.create", "escalationProfile.create", "escalationDefaults.set"];

/** A `location_admin` is refused every channel and escalation target (the route's 403 / empty list). */
export async function aLocationAdminIsRefused(): Promise<void> {
  for (const id of [...ROW_ENTRIES, ...CREATE_ENTRIES]) expect(await resolveAs(id, "location_admin"), id).toBeNull();
}

/** An `asset_group_admin` is refused: `requireMasterDataUser` throws, and a throw is a refusal. */
export async function anAssetGroupAdminIsRefused(): Promise<void> {
  for (const id of [...ROW_ENTRIES, ...CREATE_ENTRIES]) expect(await resolveAs(id, "asset_group_admin"), id).toBeNull();
}

/** An `organization_admin` outside the organization is refused. */
export async function anOrganizationAdminOutsideTheOrganizationIsRefused(): Promise<void> {
  for (const id of [...ROW_ENTRIES, ...CREATE_ENTRIES]) expect(await resolveAs(id, "organization_admin", false), id).toBeNull();
}

/** An `organization_admin` inside the organization resolves each target, with the row's name. */
export async function anOrganizationAdminInsideResolves(): Promise<void> {
  for (const id of ROW_ENTRIES) expect((await resolveAs(id, "organization_admin"))?.targetName, id).toBe("Ops");
  for (const id of CREATE_ENTRIES) expect((await resolveAs(id, "organization_admin"))?.organizationId, id).toBe(ORG);
}

/** A global admin resolves each target. */
export async function anAdminResolves(): Promise<void> {
  for (const id of [...ROW_ENTRIES, ...CREATE_ENTRIES]) expect(await resolveAs(id, "admin"), id).not.toBeNull();
}

/** The route's gate runs in the route's order, on the row's organization. */
export async function theGateAsksTheRoutesTwoChecks(): Promise<void> {
  const asked: string[] = [];
  await resolveAs("notificationChannel.update", "organization_admin", true, { asked });
  expect(asked).toEqual(["requireMasterDataUser", `canManageNotificationChannel:${ORG}`]);
}

/** D6: the profile target carries its `updatedAt`, which the propose tool stores as the precondition. */
export async function theProfileTargetCarriesItsStamp(): Promise<void> {
  expect((await resolveAs("escalationProfile.update", "admin"))?.updatedAt).toBe(STAMP.toISOString());
}

/** A create without an `organizationId` is refused (Q13: no fleet-wide channel through the copilot). */
export async function aCreateWithoutAnOrganizationIsRefused(): Promise<void> {
  for (const id of CREATE_ENTRIES) expect(await resolveAs(id, "admin", true, { body: { code: "ops" } }), id).toBeNull();
}

/** D8: `rule.notifications.set` reuses the rule target, so every role whose read scope holds the rule's asset resolves it. */
export async function theRuleChannelSetReusesTheRuleTarget(): Promise<void> {
  const access = {
    assertOperationsWriteRole: async () => undefined,
    readableAssetIds: async () => ["asset-1"],
  } as never;
  const resolver = new CopilotTargetResolver(
    oneRowDb({ name: "Chiller high", assetId: "asset-1", lifecycleStatus: "published" }),
    access,
    {} as never,
    {} as never,
  );
  const resolved = await resolver.resolve(catalogEntry("rule.notifications.set")!, { id: ROW }, { channelIds: [] }, [ORG], JWT, ORG);
  expect(resolved?.targetName).toBe("Chiller high");
}
