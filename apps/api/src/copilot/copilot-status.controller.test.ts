import { describe, it } from "vitest";

import {
  assertABadQueryIs400,
  assertACrossOrganizationScopeHasNoAttachments,
  assertAnUnavailableCopilotReadsNoAttachmentSwitch,
  assertAnUnprovisionedTokenGets403,
  assertAttachmentsEnabledComesFromTheSwitch,
  assertAttachmentsOnButCopilotOffIsOff,
  assertAttachmentsOnNeedsBothSwitches,
  assertNoKeyMeansNoAttachments,
  assertConfiguredComesFromTheResolver,
  assertOperatorsAndViewersGet403AndNoDecision,
  assertTheDecisionMapsOntoTheDto,
  assertTheDefaultOrganizationFollowsTheRole,
} from "./copilot-status.controller.spec";

describe("F3.85 — GET /copilot/status (ADR 0099 decision 5, plan §5.2)", () => {
  it("gives operators and viewers a 403 and decides nothing", () => assertOperatorsAndViewersGet403AndNoDecision());
  it("gives an unprovisioned token a 403", () => assertAnUnprovisionedTokenGets403());
  it("asks about the organization the role defaults to", () => assertTheDefaultOrganizationFollowsTheRole());
  it("maps the decision onto the DTO", () => assertTheDecisionMapsOntoTheDto());
  it("answers a malformed query with a 400", () => assertABadQueryIs400());
  it("takes configured from the resolver for the scope asked about (F3.85 PR 7)", () =>
    assertConfiguredComesFromTheResolver());
});

describe("F3.87 — attachmentsEnabled on GET /copilot/status (ADR 0099 Amendment 3 A7)", () => {
  it("takes attachmentsEnabled from the organization's switch", () => assertAttachmentsEnabledComesFromTheSwitch());
  it("gives no attachments without a key", () => assertNoKeyMeansNoAttachments());
  it("gives no attachments to a cross-organization scope", () => assertACrossOrganizationScopeHasNoAttachments());
  it("reads no attachment switch when the copilot is unavailable", () =>
    assertAnUnavailableCopilotReadsNoAttachmentSwitch());
  it("reads attachments on but the copilot off as off", () => assertAttachmentsOnButCopilotOffIsOff());
  it("needs both switches for attachmentsOn", () => assertAttachmentsOnNeedsBothSwitches());
});
