// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  anAdminCreatesAnOrgScopedChannel,
  anAdminCreatingFleetWideOmitsTheOrganization,
  anOrganizationAdminSeesItsOwnOrganizationLocked,
  editingShowsTheOrganizationAndCannotChangeIt,
  namesTheOrganizationOfEveryChannel,
  refusesSendTestOnAFleetWideChannelWithTheReason,
  rendersBothKinds,
  showsTheReadinessWarning,
  showsTheServerRefusalOnSave,
  showsWhetherASecretIsStoredWithoutShowingIt,
  surfacesAGuardRefusalAsVisibleText,
  surfacesASuccessfulTest,
} from "./notification-channels-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 *
 * The `@vitest-environment jsdom` docblock is on THIS file because Vitest reads
 * it from the file it collects (ADR 0042 decision 2). The project default stays
 * `node`; the twenty pure-logic tests beside this one do not want a DOM.
 */
describe("F3.8 notification channels page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("lists both channel kinds with what each sends to", async () => {
    await rendersBothKinds();
  });

  it("says a secret is set without ever showing or pre-filling it", async () => {
    await showsWhetherASecretIsStoredWithoutShowingIt();
  });

  it("surfaces an egress-guard refusal as visible text, not a silent no-op", async () => {
    await surfacesAGuardRefusalAsVisibleText();
  });

  it("surfaces a successful send test", async () => {
    await surfacesASuccessfulTest();
  });

  it("shows the server's reason when a save is refused", async () => {
    await showsTheServerRefusalOnSave();
  });

  it("warns when a transport is not configured", async () => {
    await showsTheReadinessWarning();
  });

  // `E7.1d` — the org-scoped/fleet-wide split (ADR 0043 Consequences).
  it("names the organization of every channel, fleet-wide included", async () => {
    await namesTheOrganizationOfEveryChannel();
  });

  it("refuses Send test on a fleet-wide channel and says why, before the click", async () => {
    await refusesSendTestOnAFleetWideChannelWithTheReason();
  });

  it("lets an admin create a channel inside an organization", async () => {
    await anAdminCreatesAnOrgScopedChannel();
  });

  it("omits organizationId entirely when an admin creates a fleet-wide channel", async () => {
    await anAdminCreatingFleetWideOmitsTheOrganization();
  });

  it("locks an organization admin to its own organization, with no fleet-wide option", async () => {
    await anOrganizationAdminSeesItsOwnOrganizationLocked();
  });

  it("shows the organization when editing and never sends it in the patch", async () => {
    await editingShowsTheOrganizationAndCannotChangeIt();
  });
});
