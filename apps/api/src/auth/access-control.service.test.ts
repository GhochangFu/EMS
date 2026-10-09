import { describe, it } from "vitest";

import {
  runAccessControlServiceTests,
  runGrantedLocationIdsTests,
  runIsOrganizationLevelAdminTests,
} from "./access-control.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E7.1c canManageNotificationChannel", () => {
  it("gates a channel write the way canManagePointKey gates a point key, minus the null-org exception", async () => {
    await runAccessControlServiceTests();
  });
});

describe("F2.10 isOrganizationLevelAdmin and grantedLocationIds (ADR 0098 decision 12, Drafter choice 9)", () => {
  it("isOrganizationLevelAdmin: admin true; organization_admin true for X and false for Y; location_admin and viewer false with no fleet query", async () => {
    await runIsOrganizationLevelAdminTests();
  });

  it("grantedLocationIds: null for admin, [] for organization_admin, 403 for a viewer", async () => {
    await runGrantedLocationIdsTests();
  });
});
