// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  admitsTheTwoRolesThatMayManageChannels,
  refusesALocationAdmin,
  sendsANonAdminRoleToTheDashboard,
  staysOpenToMasterDataAdminsWhenTheFlagIsNotSet,
} from "./admin-route.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("E7.1d admin route gate", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("admits admin and organization_admin to the notification screens", () => {
    admitsTheTwoRolesThatMayManageChannels();
  });

  it("refuses a location_admin, rather than showing it an empty table", () => {
    refusesALocationAdmin();
  });

  it("sends a non-admin role to the dashboard", () => {
    sendsANonAdminRoleToTheDashboard();
  });

  it("leaves an ungated admin route open to every master-data admin", () => {
    staysOpenToMasterDataAdminsWhenTheFlagIsNotSet();
  });
});
