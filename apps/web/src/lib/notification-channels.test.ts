import { describe, expect, it } from "vitest";

import type { NotificationChannelDto } from "@bms/shared";

import {
  blankChannelForm,
  channelFormToPayload,
  deliveryStatusLabel,
  deliveryStatusTone,
  formFromChannel,
  targetFromConfig,
  testResultMessage,
} from "./notification-channels";

const channel: NotificationChannelDto = {
  id: "33333333-3333-3333-3333-333333333333",
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
