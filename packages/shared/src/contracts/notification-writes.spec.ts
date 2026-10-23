import { expect } from "vitest";

import {
  copilotCreateNotificationChannelModelBodySchema,
  copilotUpdateNotificationChannelModelBodySchema,
  copilotWebhookUrlSchema,
  createNotificationChannelBodySchema,
} from "./notification-writes";

/**
 * `F4.279` (ADR 0099 Amendment 8, Q11–Q13, ADR 0030) — the notification-channel
 * request bodies, now in `@bms/shared`, and the copilot's narrower model bodies.
 * No database: every claim is a parse.
 */

const ORG = "00000000-0000-4000-8000-000000000001";

const EMAIL_CREATE = {
  organizationId: ORG,
  code: "ops",
  name: "Ops",
  kind: "email",
  config: { to: ["ops@example.test"] },
};

/** Q13: the copilot's create names its organization; a fleet-wide channel stays on the page. */
export function theCreateModelBodyRefusesNoOrganization(): void {
  const { organizationId: _omitted, ...body } = EMAIL_CREATE;
  expect(copilotCreateNotificationChannelModelBodySchema.safeParse(body).success).toBe(false);
}

/** Q11: the secret is typed on the Confirm card; the model never proposes one. */
export function theCreateModelBodyRefusesASecret(): void {
  expect(
    copilotCreateNotificationChannelModelBodySchema.safeParse({ ...EMAIL_CREATE, secret: "s3cret-value" }).success,
  ).toBe(false);
}

/** Q12: the webhook URL is typed on the Confirm card; the model never proposes one. */
export function theCreateModelBodyRefusesAUrl(): void {
  expect(
    copilotCreateNotificationChannelModelBodySchema.safeParse({
      ...EMAIL_CREATE,
      kind: "webhook",
      config: { url: "https://hooks.example.test/x" },
    }).success,
  ).toBe(false);
}

/** Q12: the email recipient list is proposed by the model. */
export function theCreateModelBodyAcceptsRecipients(): void {
  expect(copilotCreateNotificationChannelModelBodySchema.safeParse(EMAIL_CREATE).success).toBe(true);
}

/** Q6: the copilot's kind is email or webhook only. */
export function theCreateModelBodyRefusesAnotherKind(): void {
  expect(copilotCreateNotificationChannelModelBodySchema.safeParse({ ...EMAIL_CREATE, kind: "sms" }).success).toBe(false);
}

/** Q5: `enabled` belongs to the deactivate and reactivate entries, not the update. */
export function theUpdateModelBodyRefusesEnabled(): void {
  expect(copilotUpdateNotificationChannelModelBodySchema.safeParse({ enabled: false }).success).toBe(false);
}

/** An empty PATCH is refused, as the route refuses it. */
export function theUpdateModelBodyRefusesAnEmptyObject(): void {
  expect(copilotUpdateNotificationChannelModelBodySchema.safeParse({}).success).toBe(false);
}

/** The positive control for the update: a name alone parses. */
export function theUpdateModelBodyAcceptsAName(): void {
  expect(copilotUpdateNotificationChannelModelBodySchema.safeParse({ name: "Ops desk" }).success).toBe(true);
}

/** The card's rule for a typed URL refuses text that is not a URL. */
export function theWebhookUrlRefusesText(): void {
  expect(copilotWebhookUrlSchema.safeParse("not a url").success).toBe(false);
}

/** The route's own create body still takes a webhook URL and a secret (the page's path). */
export function theRouteBodyAcceptsAWebhook(): void {
  expect(
    createNotificationChannelBodySchema.safeParse({
      code: "hook",
      name: "Hook",
      kind: "webhook",
      config: { url: "https://hooks.example.test/x" },
      secret: "s3cret-value",
    }).success,
  ).toBe(true);
}
