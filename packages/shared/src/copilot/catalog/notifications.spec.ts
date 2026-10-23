import { expect } from "vitest";

import {
  copilotClearEscalationDefaultsModelBodySchema,
  copilotCreateNotificationChannelModelBodySchema,
} from "../../contracts";
import { catalogEntry, EXCLUDED_ROUTES } from "./index";
import { modelBodyOf } from "./model-body";
import type { CatalogEntry, CatalogSummaryInput } from "./types";

/**
 * `F4.279` (ADR 0099 Amendment 8, D2–D8, Q11–Q13; owner rulings 2026-10-24
 * Q1–Q10) — the notification and escalation entries. The rules every entry
 * obeys are `catalog.spec.ts`; this file holds what is particular to these
 * ten. Vitest entry point: the sibling `.test.ts`.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const ROW = "22222222-2222-4222-8222-222222222222";

const CHANNEL_IDS = [
  "notificationChannel.create",
  "notificationChannel.update",
  "notificationChannel.deactivate",
  "notificationChannel.reactivate",
  "notificationChannel.test",
];
const ESCALATION_IDS = ["escalationProfile.create", "escalationProfile.update", "escalationDefaults.set", "escalationDefaults.clear"];

function entry(id: string): CatalogEntry {
  const found = catalogEntry(id);
  if (!found) throw new Error(`no catalog entry ${id}`);
  return found;
}

function summary(id: string, input: Partial<CatalogSummaryInput> = {}): string {
  return entry(id).summary({ body: {}, params: { id: ROW }, targetName: "Ops", organizationName: "Pune Works", ...input });
}

/** The channel and escalation entries are for the two roles the routes admit (`canManageNotificationChannel`). */
export function theChannelAndEscalationEntriesAreForTheChannelAdmins(): void {
  for (const id of [...CHANNEL_IDS, ...ESCALATION_IDS]) {
    expect(entry(id).offeredTo, id).toEqual(["admin", "organization_admin"]);
  }
}

/** `rule.notifications.set` is offered to every copilot role, as the rule route's `configuration` class is. */
export function theRuleChannelSetIsForEveryRole(): void {
  expect(entry("rule.notifications.set").offeredTo).toBeUndefined();
}

/** D2: the creates name their organization with the notification authority; the rows name their own. */
export function theTargetsMirrorTheRoutes(): void {
  expect({
    channelCreate: entry("notificationChannel.create").target,
    channelRow: entry("notificationChannel.update").target,
    profileCreate: entry("escalationProfile.create").target,
    profileRow: entry("escalationProfile.update").target,
    defaults: entry("escalationDefaults.set").target,
    rule: entry("rule.notifications.set").target,
  }).toEqual({
    channelCreate: { kind: "organization", manage: "notification" },
    channelRow: { kind: "notificationChannel", param: "id" },
    profileCreate: { kind: "organization", manage: "notification" },
    profileRow: { kind: "escalationProfile", param: "id" },
    defaults: { kind: "organization", manage: "notification" },
    rule: { kind: "rule", param: "id" },
  });
}

/** Q11, Q12: the webhook secret and URL are typed on the card, on the two channel bodies that carry them. */
export function theSecretAndUrlAreClientOnly(): void {
  expect(entry("notificationChannel.create").clientOnly).toEqual(["secret", "config.url"]);
  expect(entry("notificationChannel.update").clientOnly).toEqual(["secret", "config.url"]);
}

/** D5: every entry stores the card-only recipient list. */
export function everyEntryStoresTheRecipientsForTheCard(): void {
  for (const id of [...CHANNEL_IDS, ...ESCALATION_IDS, "rule.notifications.set"]) {
    expect(entry(id).cardOnly, id).toEqual(["recipients"]);
  }
}

/** Q13: the copilot's channel create requires the organization. */
export function theChannelCreateModelBodyRequiresTheOrganization(): void {
  expect(entry("notificationChannel.create").modelBody).toBe(copilotCreateNotificationChannelModelBodySchema);
  expect(
    modelBodyOf(entry("notificationChannel.create")).safeParse({ code: "ops", name: "Ops", kind: "email" }).success,
  ).toBe(false);
}

/** Q5: deactivate and reactivate are the two directions on the PATCH, each a fixed body; deactivate is red. */
export function theDirectionEntriesHaveFixedBodies(): void {
  const off = entry("notificationChannel.deactivate");
  const on = entry("notificationChannel.reactivate");
  expect([off.fixedBody, off.risk, on.fixedBody, on.risk]).toEqual([{ enabled: false }, "deactivate", { enabled: true }, "edit"]);
}

/** Q1: the test send is red, takes no body, and its summary says a real message goes out. */
export function theTestSendIsRedAndSaysARealMessageGoesOut(): void {
  const test = entry("notificationChannel.test");
  expect([test.risk, test.bodyName, test.method, test.path]).toEqual(["deactivate", null, "POST", "/notifications/channels/:id/test"]);
  expect(summary("notificationChannel.test")).toContain("a real message");
}

/** Q2, D3: clearing the severity map is its own red entry on the same PUT, with the empty map as its model body. */
export function theClearIsARedEntryOnTheSamePut(): void {
  const set = entry("escalationDefaults.set");
  const clear = entry("escalationDefaults.clear");
  expect([clear.method, clear.path, clear.body, clear.risk]).toEqual([set.method, set.path, set.body, "deactivate"]);
  expect(clear.modelBody).toBe(copilotClearEscalationDefaultsModelBodySchema);
}

/** The clear's summary says that nothing escalates. */
export function theClearSummarySaysNothingEscalates(): void {
  expect(summary("escalationDefaults.clear", { body: { organizationId: ORG, items: [] } })).toContain("no severity escalates");
}

/** An empty rule channel set says the rule then notifies nobody. */
export function anEmptyRuleChannelSetSaysNobody(): void {
  expect(summary("rule.notifications.set", { body: { channelIds: [] } })).toContain("notifies nobody");
}

/** D5: no summary names an address; the channel create names its kind and name. */
export function theChannelCreateSummaryNamesNoAddress(): void {
  const text = summary("notificationChannel.create", {
    body: { organizationId: ORG, code: "ops", name: "Ops", kind: "email", config: { to: ["a@example.test"] } },
  });
  expect(text).toBe('Create the email channel "Ops" (ops) in Pune Works.');
}

/** "Not in this amendment": the two DELETE routes stay manual. */
export function theTwoDeletesAreExcluded(): void {
  const paths = EXCLUDED_ROUTES.filter((route) => route.method === "DELETE").map((route) => route.path);
  expect(paths).toEqual(expect.arrayContaining(["/notifications/channels/:id", "/admin/escalation-profiles/:id"]));
}
