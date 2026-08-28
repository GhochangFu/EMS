// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  bannerAppearsWhenATransportIsUnconfigured,
  bannerIsSilentWhenEverythingIsConfigured,
  bannerIsSilentWhenTheCheckFails,
  explainsAnEmptyLedger,
  filtersTheLedgerByOrganization,
  labelsATestSendWithNoRule,
  namesTheOrganizationOfEveryAttempt,
  offersOnlyOrganizationsPresentInTheLedger,
  showsEverySkipWithoutAsking,
} from "./notification-deliveries-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.8 notification deliveries", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows all five statuses, skips included, with no default filter", async () => {
    await showsEverySkipWithoutAsking();
  });

  it("labels a send test as having no rule", async () => {
    await labelsATestSendWithNoRule();
  });

  it("explains an empty ledger instead of looking broken", async () => {
    await explainsAnEmptyLedger();
  });

  it("shows the readiness banner when a transport is not configured", async () => {
    await bannerAppearsWhenATransportIsUnconfigured();
  });

  it("stays silent when everything is configured", async () => {
    await bannerIsSilentWhenEverythingIsConfigured();
  });

  it("stays silent when the readiness check itself fails", async () => {
    await bannerIsSilentWhenTheCheckFails();
  });

  // `E7.1d` — the ledger names its tenants (ADR 0043 Consequences).
  it("names the organization of every attempt", async () => {
    await namesTheOrganizationOfEveryAttempt();
  });

  it("narrows the ledger to one organization on request, not by default", async () => {
    await filtersTheLedgerByOrganization();
  });

  it("offers only the organizations the ledger actually contains", async () => {
    await offersOnlyOrganizationsPresentInTheLedger();
  });
});
