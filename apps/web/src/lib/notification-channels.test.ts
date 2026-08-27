import { describe, expect, it } from "vitest";

import type { NotificationChannelDto } from "@bms/shared";

import {
  blankChannelForm,
  channelFormToPatch,
  channelFormToPayload,
  channelOrganizationOptions,
  deliveryStatusLabel,
  deliveryStatusTone,
  formFromChannel,
  organizationLabel,
  sendTestRefusal,
  targetFromConfig,
  testResultMessage,
} from "./notification-channels";

const channel: NotificationChannelDto = {
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

/** `F3.8` U8 — what the notification screens decide, tested without a DOM. */
describe("notification channel form", () => {
  it("never populates the secret box from a stored channel", () => {
    // The DTO carries `hasSecret` and nothing else about it, so there is
    // nothing to populate with — and a placeholder that looked like a value
    // would teach an operator the stored secret is retrievable.
    expect(formFromChannel(channel).secret).toBe("");
    expect(JSON.stringify(formFromChannel(channel))).not.toContain("•");
  });

  it("omits `secret` when the box is untouched, so the stored one is kept", () => {
    const form = { ...formFromChannel(channel), name: "Renamed" };
    const payload = channelFormToPayload(form);
    // Not `secret: ""` — that would CLEAR it, so renaming a channel would
    // silently unsign every webhook it serves.
    expect("secret" in payload).toBe(false);
    expect(payload.name).toBe("Renamed");
  });

  it("sends the secret when one is typed", () => {
    const payload = channelFormToPayload({ ...blankChannelForm(), secret: "new-secret-value" });
    expect(payload.secret).toBe("new-secret-value");
  });

  it("splits email recipients and keeps a webhook url whole", () => {
    const email = channelFormToPayload({
      ...blankChannelForm(),
      kind: "email",
      target: " a@b.c , d@e.f ,, ",
    });
    expect(email.config).toEqual({ to: ["a@b.c", "d@e.f"] });

    const webhook = channelFormToPayload({
      ...blankChannelForm(),
      kind: "webhook",
      target: "https://hooks.example.com/services/ABC",
    });
    expect(webhook.config).toEqual({ url: "https://hooks.example.com/services/ABC" });
  });

  it("reads the target back out of either config shape", () => {
    expect(targetFromConfig(channel)).toBe("https://hooks.example.com/x");
    expect(targetFromConfig({ ...channel, config: { to: ["a@b.c", "d@e.f"] } })).toBe(
      "a@b.c, d@e.f",
    );
    expect(targetFromConfig({ ...channel, config: {} })).toBe("");
  });
});

describe("delivery status presentation", () => {
  it("names all five statuses in words an operator can act on", () => {
    expect(deliveryStatusLabel("sent")).toBe("Sent");
    expect(deliveryStatusLabel("failed")).toBe("Failed");
    expect(deliveryStatusLabel("skipped_unconfigured")).toContain("not configured");
    expect(deliveryStatusLabel("skipped_deduped")).toContain("already open");
    expect(deliveryStatusLabel("skipped_rate_limited")).toContain("rate limited");
  });

  it("does not render the two skips that mean nobody was told as calm grey", () => {
    // Three of five statuses are skips. The two that mean a person was NOT told
    // about an alarm must not look like "disabled" — that is how they get
    // scrolled past.
    expect(deliveryStatusTone("skipped_unconfigured")).toBe("warning");
    expect(deliveryStatusTone("skipped_rate_limited")).toBe("warning");
    // This one is the system working: the alarm was already open and somebody
    // was already told.
    expect(deliveryStatusTone("skipped_deduped")).toBe("info");
    expect(deliveryStatusTone("sent")).toBe("ok");
    expect(deliveryStatusTone("failed")).toBe("critical");
  });
});

describe("send-test message", () => {
  it("reports a guard refusal as a refusal, with the reason", () => {
    const message = testResultMessage({
      channelId: channel.id,
      channelCode: "ops-webhook",
      status: "failed",
      deliveryId: null,
      error: "webhook host grafana resolves to a private, loopback or link-local address",
    });
    expect(message).toContain("failed");
    expect(message).toContain("private");
    expect(message).toContain("ops-webhook");
  });

  it("says something specific for every status, never an empty result", () => {
    for (const status of [
      "sent",
      "failed",
      "skipped_unconfigured",
      "skipped_deduped",
      "skipped_rate_limited",
    ] as const) {
      const message = testResultMessage({
        channelId: channel.id,
        channelCode: "ops-webhook",
        status,
        deliveryId: null,
        error: null,
      });
      expect(message.length).toBeGreaterThan(10);
      expect(message).toContain("ops-webhook");
    }
  });
});

/**
 * `E7.1d` — the org-scoped/fleet-wide split (ADR 0043 Consequences).
 *
 * The API decided all of this in `E7.1c`; these prove the client agrees with
 * it rather than re-deriving it. Each assertion below names the API rule it
 * mirrors, because a client that drifts from one of them produces a refusal
 * the operator cannot act on.
 */
describe("E7.1d channel organization scope", () => {
  const orgs = [
    { id: "aaaaaaaa-0000-0000-0000-000000000001", name: "Ion Exchange", active: true },
    { id: "aaaaaaaa-0000-0000-0000-000000000002", name: "PHE West Bengal", active: true },
    { id: "aaaaaaaa-0000-0000-0000-000000000003", name: "Retired Org", active: false },
  ];

  it("offers an admin fleet-wide plus every active organization", () => {
    const options = channelOrganizationOptions("admin", orgs);
    expect(options[0]).toEqual({ value: "", label: "Fleet-wide (all organizations)" });
    expect(options.map((option) => option.label)).toEqual([
      "Fleet-wide (all organizations)",
      "Ion Exchange",
      "PHE West Bengal",
    ]);
  });

  it("never offers an organization_admin the fleet-wide option", () => {
    // `canManageNotificationChannel` returns false for a null organization on
    // this role, so a fleet-wide entry here would always answer 403.
    const options = channelOrganizationOptions("organization_admin", orgs);
    expect(options.some((option) => option.value === "")).toBe(false);
    expect(options.map((option) => option.label)).toEqual(["Ion Exchange", "PHE West Bengal"]);
  });

  it("offers a location_admin nothing — the read gate is the write gate", () => {
    // `ChannelsService.list` returns [] for this role unconditionally, so
    // there is no channel for it to place in an organization.
    expect(channelOrganizationOptions("location_admin", orgs)).toEqual([]);
    expect(channelOrganizationOptions("operator", orgs)).toEqual([]);
    expect(channelOrganizationOptions("viewer", orgs)).toEqual([]);
  });

  it("omits `organizationId` for a fleet-wide choice rather than sending an empty string", () => {
    // The API types it `z.string().uuid().optional()`. Omitted means
    // fleet-wide; `""` would be a 400 dressed up as a deliberate choice.
    const payload = channelFormToPayload({ ...blankChannelForm(), code: "ops", name: "Ops" });
    expect("organizationId" in payload).toBe(false);

    const scoped = channelFormToPayload({
      ...blankChannelForm(),
      code: "ops",
      name: "Ops",
      organizationId: orgs[0]!.id,
    });
    expect(scoped.organizationId).toBe(orgs[0]!.id);
  });

  it("keeps `organizationId` out of a PATCH — a channel cannot change tenant", () => {
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
  });

  it("round-trips a fleet-wide channel through the edit form as Fleet-wide", () => {
    expect(formFromChannel(channel).organizationId).toBe("");
    expect(
      formFromChannel({ ...channel, organizationId: orgs[1]!.id }).organizationId,
    ).toBe(orgs[1]!.id);
  });

  it("refuses Send test on a fleet-wide channel, and says why", () => {
    // `NotificationsService.sendTest` throws a 400 here: a delivery row has
    // carried `organization_id NOT NULL` since migration 0048.
    const refusal = sendTestRefusal(channel);
    expect(refusal).not.toBeNull();
    expect(refusal).toMatch(/no organization/i);
    expect(sendTestRefusal({ ...channel, organizationId: orgs[0]!.id })).toBeNull();
  });

  it("names an organization rather than printing its uuid", () => {
    expect(organizationLabel(orgs[0]!.id, orgs)).toBe("Ion Exchange");
    expect(organizationLabel(null, orgs)).toBe("Fleet-wide");
    // A deactivated org still resolves — the lookup list is fetched with
    // "all" precisely so a real row does not render as "Unknown".
    expect(organizationLabel(orgs[2]!.id, orgs)).toBe("Retired Org");
    // Falls back to the id, never to a word that reads like a bug.
    expect(organizationLabel("aaaaaaaa-0000-0000-0000-00000000ffff", orgs)).toBe(
      "aaaaaaaa-0000-0000-0000-00000000ffff",
    );
  });
});
