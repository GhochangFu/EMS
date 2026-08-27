import { expect } from "vitest";

import type { NotificationChannelDto } from "@bms/shared";

import {
  blankChannelForm,
  channelFormToPatch,
  channelFormToPayload,
  channelOrganizationOptions,
  formFromChannel,
  organizationChoiceRefusal,
  organizationLabel,
  sendTestRefusal,
} from "./notification-channels";

/**
 * `E7.1d` — the org-scoped/fleet-wide split, without a DOM (ADR 0043
 * Consequences).
 *
 * Assertions live here and `notification-channels.test.ts` runs them
 * (ADR 0014). The API decided all of this in `E7.1c`; these prove the client
 * agrees with it rather than re-deriving it. Each assertion names the API rule
 * it mirrors, because a client that drifts from one of them produces a refusal
 * the operator cannot act on.
 */

const fleetWideChannel: NotificationChannelDto = {
  id: "33333333-3333-3333-3333-333333333333",
  organizationId: null,
  code: "ops-webhook",
  name: "Operations webhook",
  kind: "webhook",
  config: { url: "https://hooks.example.com/x" },
  enabled: true,
  hasSecret: true,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

const orgs = [
  { id: "aaaaaaaa-0000-0000-0000-000000000001", name: "Ion Exchange", active: true },
  { id: "aaaaaaaa-0000-0000-0000-000000000002", name: "PHE West Bengal", active: true },
  { id: "aaaaaaaa-0000-0000-0000-000000000003", name: "Retired Org", active: false },
];

export function offersAnAdminFleetWidePlusEveryActiveOrganization(): void {
  const options = channelOrganizationOptions("admin", orgs);
  expect(options[0]).toEqual({ value: "", label: "Fleet-wide (all organizations)" });
  expect(options.map((option) => option.label)).toEqual([
    "Fleet-wide (all organizations)",
    "Ion Exchange",
    "PHE West Bengal",
  ]);
}

export function neverOffersAnOrganizationAdminTheFleetWideOption(): void {
  // `canManageNotificationChannel` returns false for a null organization on
  // this role, so a fleet-wide entry here would always answer 403.
  const options = channelOrganizationOptions("organization_admin", orgs);
  expect(options.some((option) => option.value === "")).toBe(false);
  expect(options.map((option) => option.label)).toEqual(["Ion Exchange", "PHE West Bengal"]);
}

export function offersEveryOtherRoleNothing(): void {
  // `ChannelsService.list` returns [] for these roles unconditionally, so
  // there is no channel for them to place in an organization.
  expect(channelOrganizationOptions("location_admin", orgs)).toEqual([]);
  expect(channelOrganizationOptions("operator", orgs)).toEqual([]);
  expect(channelOrganizationOptions("viewer", orgs)).toEqual([]);
}

export function omitsOrganizationIdForAFleetWideChoice(): void {
  // The API types it `z.string().uuid().optional()`. Omitted means fleet-wide;
  // `""` would be a 400 dressed up as a deliberate choice.
  const payload = channelFormToPayload({ ...blankChannelForm(), code: "ops", name: "Ops" });
  expect("organizationId" in payload).toBe(false);

  const scoped = channelFormToPayload({
    ...blankChannelForm(),
    code: "ops",
    name: "Ops",
    organizationId: orgs[0]!.id,
  });
  expect(scoped.organizationId).toBe(orgs[0]!.id);
}

export function keepsOrganizationIdOutOfAPatch(): void {
  // `updateNotificationChannelBodySchema` declares neither `code` nor
  // `organizationId`. Zod strips both silently, which is exactly why the
  // client must not send them: a 200 would look like the move worked.
  const patch = channelFormToPatch({
    ...blankChannelForm(),
    code: "ops",
    name: "Ops",
    organizationId: orgs[0]!.id,
  });
  expect("organizationId" in patch).toBe(false);
  expect("code" in patch).toBe(false);
  expect(patch.name).toBe("Ops");
}

export function roundTripsAFleetWideChannelThroughTheEditForm(): void {
  expect(formFromChannel(fleetWideChannel).organizationId).toBe("");
  expect(
    formFromChannel({ ...fleetWideChannel, organizationId: orgs[1]!.id }).organizationId,
  ).toBe(orgs[1]!.id);
}

export function refusesSendTestOnAFleetWideChannelWithAReason(): void {
  // `NotificationsService.sendTest` throws a 400 here: a delivery row has
  // carried `organization_id NOT NULL` since migration 0048.
  const refusal = sendTestRefusal(fleetWideChannel);
  expect(refusal).not.toBeNull();
  expect(refusal).toMatch(/no organization/i);
  expect(sendTestRefusal({ ...fleetWideChannel, organizationId: orgs[0]!.id })).toBeNull();
}

export function namesAnOrganizationRatherThanPrintingItsUuid(): void {
  expect(organizationLabel(orgs[0]!.id, orgs)).toBe("Ion Exchange");
  expect(organizationLabel(null, orgs)).toBe("Fleet-wide");
  // A deactivated org still resolves — the lookup list is fetched with "all"
  // precisely so a real row does not render as "Unknown".
  expect(organizationLabel(orgs[2]!.id, orgs)).toBe("Retired Org");
  // Falls back to the id, never to a word that reads like a bug.
  expect(organizationLabel("aaaaaaaa-0000-0000-0000-00000000ffff", orgs)).toBe(
    "aaaaaaaa-0000-0000-0000-00000000ffff",
  );
}

/**
 * A multi-grant `organization_admin` must choose, and is told so.
 *
 * Two or more options means the control is not locked, and a blank form holds
 * `""` — which matches no option for this role. Submitting that omits
 * `organizationId`, and `resolveCreateTargetOrg` answers
 * "You manage more than one organization — specify organizationId explicitly".
 * The refusal has to arrive before the click, not as a 400 the operator cannot
 * connect to anything they did.
 */
export function asksAMultiGrantOrganizationAdminToChoose(): void {
  const options = channelOrganizationOptions("organization_admin", orgs);
  const refusal = organizationChoiceRefusal("organization_admin", options, "");
  expect(refusal).not.toBeNull();
  expect(refusal).toMatch(/choose an organization/i);

  // Once chosen, nothing stands in the way.
  expect(organizationChoiceRefusal("organization_admin", options, orgs[0]!.id)).toBeNull();
}

/**
 * Every grant deactivated is a third state, not "locked to the first one".
 *
 * `channelOrganizationOptions` filters to active organizations while
 * `writableOrganizationIds` does not, so the two lists can disagree. Treating
 * an empty list as locked would send no `organizationId` and let the API
 * resolve a tenant the picker deliberately refused to offer.
 */
export function refusesCreateWhenNoActiveOrganizationIsAdministered(): void {
  const options = channelOrganizationOptions("organization_admin", [
    { id: orgs[2]!.id, name: "Retired Org", active: false },
  ]);
  expect(options).toEqual([]);

  const refusal = organizationChoiceRefusal("organization_admin", options, "");
  expect(refusal).not.toBeNull();
  expect(refusal).toMatch(/no active organization/i);
}

/** An `admin` is never refused: `""` is Fleet-wide there, and it is the default. */
export function neverRefusesAnAdminItsFleetWideDefault(): void {
  const options = channelOrganizationOptions("admin", orgs);
  expect(organizationChoiceRefusal("admin", options, "")).toBeNull();
  expect(organizationChoiceRefusal("admin", options, orgs[0]!.id)).toBeNull();
  // Even with nothing to offer: fleet-wide needs no organization to exist.
  expect(organizationChoiceRefusal("admin", [], "")).toBeNull();
}
