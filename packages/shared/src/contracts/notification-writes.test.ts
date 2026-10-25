import { describe, it } from "vitest";

import {
  theCreateModelBodyAcceptsRecipients,
  theCreateModelBodyRefusesASecret,
  theCreateModelBodyRefusesAUrl,
  theCreateModelBodyRefusesAnotherKind,
  theCreateModelBodyRefusesNoOrganization,
  theRouteBodyAcceptsAWebhook,
  theUpdateModelBodyAcceptsAName,
  theUpdateModelBodyRefusesAnEmptyObject,
  theUpdateModelBodyRefusesEnabled,
  theWebhookUrlRefusesText,
} from "./notification-writes.spec";

/** `F4.279` — Vitest entry point for the notification-channel request bodies. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.279 — notification-channel request bodies", () => {
  it("the copilot create model body refuses a missing organizationId", () => {
    theCreateModelBodyRefusesNoOrganization();
  });

  it("the copilot create model body refuses a secret", () => {
    theCreateModelBodyRefusesASecret();
  });

  it("the copilot create model body refuses config.url", () => {
    theCreateModelBodyRefusesAUrl();
  });

  it("the copilot create model body accepts config.to", () => {
    theCreateModelBodyAcceptsRecipients();
  });

  it("the copilot create model body refuses a kind other than email or webhook", () => {
    theCreateModelBodyRefusesAnotherKind();
  });

  it("the copilot update model body refuses enabled", () => {
    theUpdateModelBodyRefusesEnabled();
  });

  it("the copilot update model body refuses an empty object", () => {
    theUpdateModelBodyRefusesAnEmptyObject();
  });

  it("the copilot update model body accepts a name alone", () => {
    theUpdateModelBodyAcceptsAName();
  });

  it("the typed webhook URL refuses text that is not a URL", () => {
    theWebhookUrlRefusesText();
  });

  it("the route's create body still accepts a webhook URL and a secret", () => {
    theRouteBodyAcceptsAWebhook();
  });
});
