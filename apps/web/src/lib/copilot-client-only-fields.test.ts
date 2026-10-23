import { describe, it } from "vitest";

import {
  anEmailCreateShowsNoBox,
  anotherEntrysFieldIsRequired,
  aWebhookCreateShowsBothBoxes,
  aWebhookUpdateThatReplacesConfigAsksForTheUrl,
  aWebhookUpdateWithoutConfigShowsTheSecretOnly,
  theSchemasAreTheRoutesRules,
} from "./copilot-client-only-fields.spec";

/** `F4.279` — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F4.279 — the Confirm card's clientOnly boxes (Q11, Q12, Q10)", () => {
  it("an email create shows no box", () => anEmailCreateShowsNoBox());
  it("a webhook create shows the URL box (required) and the secret box (optional)", () => aWebhookCreateShowsBothBoxes());
  it("a webhook update without config shows the secret box only", () => aWebhookUpdateWithoutConfigShowsTheSecretOnly());
  it("a webhook update that replaces config asks for the URL", () => aWebhookUpdateThatReplacesConfigAsksForTheUrl());
  it("the boxes check the route's own rules", () => theSchemasAreTheRoutesRules());
  it("another entry's clientOnly field is shown and required", () => anotherEntrysFieldIsRequired());
});
