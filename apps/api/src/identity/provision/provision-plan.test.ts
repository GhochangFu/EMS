import { describe, it } from "vitest";

import * as spec from "./provision-plan.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.78 U4 — provision plan (ADR 0089 decisions 4–6)", () => {
  it("the desired client has no secret", () => {
    spec.assertTheDesiredClientHasNoSecret();
  });

  it("the desired client is a confidential, service-account-only client", () => {
    spec.assertTheDesiredClientIsAConfidentialServiceAccount();
  });

  it("the desired realm settings carry length(12)", () => {
    spec.assertTheRealmSettingsCarryTheLengthTwelvePolicy();
  });

  it("the desired realm settings turn brute-force protection on", () => {
    spec.assertTheRealmSettingsTurnBruteForceProtectionOn();
  });

  it('the user profile\'s email.permissions.edit becomes ["admin"]', () => {
    spec.assertTheProfileLetsOnlyAnAdminEditTheEmail();
  });

  it("the user-profile transform keeps every other key", () => {
    spec.assertTheProfileTransformKeepsEverythingElse();
  });

  it("the user-profile transform does not mutate its input", () => {
    spec.assertTheProfileTransformDoesNotMutateItsInput();
  });

  it("a user profile with no email attribute is refused", () => {
    spec.assertAProfileWithNoEmailAttributeIsRefused();
  });

  it("the report lists a user that is unverified and unlinked", () => {
    spec.assertTheReportListsAnUnverifiedUnlinkedUser();
  });

  it("the report omits a user that is only unlinked", () => {
    spec.assertTheReportOmitsAVerifiedUnlinkedUser();
  });

  it("the report omits a user that is only unverified", () => {
    spec.assertTheReportOmitsAnUnverifiedLinkedUser();
  });

  it("the report omits a realm user with no bms.users row", () => {
    spec.assertTheReportOmitsARealmUserWithNoRow();
  });

  it("the report carries emails, no ids", () => {
    spec.assertTheReportCarriesEmailsAndNoIds();
  });

  it("the report is empty when every row is linked", () => {
    spec.assertTheReportIsEmptyWhenEveryoneIsLinked();
  });
});
