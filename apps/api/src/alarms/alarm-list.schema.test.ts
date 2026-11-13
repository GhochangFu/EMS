import { describe, it } from "vitest";

import * as spec from "./alarm-list.schema.spec";
import {
  assertAbsentStateDefaultsToAll,
  assertActiveStateParses,
  assertAnUnknownKeyIsRefused,
  assertAssetIdsIsCappedAtTheSharedMaximum,
  assertEmptyLimitIsAbsent,
  assertInfiniteLimitParsesForTheServiceClamp,
  assertListAbsentOrganizationIdIsUndefined,
  assertListOrganizationIdAloneParses,
  assertListOrganizationIdBesideAssetIdsParses,
  assertListOrganizationIdMustBeAUuid,
  assertSummaryOrganizationIdAloneParses,
  assertSummaryOrganizationIdMustBeAUuid,
  assertNegativeLimitParsesForTheServiceClamp,
  assertNonNumericLimitIsRefused,
  assertOverCapFractionalLimitParses,
  assertSubOneFractionalLimitParses,
  assertSummaryQueryAcceptsAnEmptyQuery,
  assertSummaryQueryAcceptsAssetIdsAlone,
  assertSummaryQueryRefusesAnUnknownKey,
  assertUnknownStateValueIsRefused,
  assertZeroLimitParsesForTheServiceClamp,
} from "./alarm-list.schema.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.28 — alarmListQuerySchema (ADR 0074, plan decisions 1 and 4)", () => {
  it("defaults state to 'all' when absent", () => {
    assertAbsentStateDefaultsToAll();
  });

  it("refuses state=open — not a live value", () => {
    assertUnknownStateValueIsRefused();
  });

  it("accepts state=active", () => {
    assertActiveStateParses();
  });

  it("refuses an unknown query key", () => {
    assertAnUnknownKeyIsRefused();
  });

  it("caps assetIds at the shared maximum", () => {
    assertAssetIdsIsCappedAtTheSharedMaximum();
  });

  it("parses limit=0 for the service clamp", () => {
    assertZeroLimitParsesForTheServiceClamp();
  });

  it("parses a negative limit for the service clamp", () => {
    assertNegativeLimitParsesForTheServiceClamp();
  });

  it("reads an empty limit= as absent", () => {
    assertEmptyLimitIsAbsent();
  });

  it("parses limit=Infinity for the service clamp", () => {
    assertInfiniteLimitParsesForTheServiceClamp();
  });

  it("parses limit=0.5 for the service clamp", () => {
    assertSubOneFractionalLimitParses();
  });

  it("parses limit=150.5 for the service clamp", () => {
    assertOverCapFractionalLimitParses();
  });

  it("refuses a non-numeric limit", () => {
    assertNonNumericLimitIsRefused();
  });
});

describe("F3.28 — alarmSummaryQuerySchema", () => {
  it("accepts assetIds alone", () => {
    assertSummaryQueryAcceptsAssetIdsAlone();
  });

  it("accepts an empty query", () => {
    assertSummaryQueryAcceptsAnEmptyQuery();
  });

  it("refuses an unknown key", () => {
    assertSummaryQueryRefusesAnUnknownKey();
  });
});

describe("F3.66 — organizationId on the alarm list and summary queries", () => {
  it("refuses a non-uuid organizationId on the list", () => {
    assertListOrganizationIdMustBeAUuid();
  });

  it("parses organizationId alone on the list", () => {
    assertListOrganizationIdAloneParses();
  });

  it("parses organizationId beside assetIds on the list", () => {
    assertListOrganizationIdBesideAssetIdsParses();
  });

  it("leaves an absent organizationId undefined on the list", () => {
    assertListAbsentOrganizationIdIsUndefined();
  });

  it("refuses a non-uuid organizationId on the summary", () => {
    assertSummaryOrganizationIdMustBeAUuid();
  });

  it("parses organizationId alone on the summary", () => {
    assertSummaryOrganizationIdAloneParses();
  });
});

describe("alarm list/summary queries — locationId (F4.357 U2, ADR 0130 decision 15)", () => {
  it("accepts a uuid locationId on both reads", () => spec.assertBothQueriesAcceptALocationId());
  it("refuses a non-uuid locationId on both reads, and still refuses an unknown key", () =>
    spec.assertBothQueriesRefuseANonUuidLocationId());
});

describe("alarm list query — state=unacknowledged and minSeverityRank (F4.357 U2b, plan Q1)", () => {
  it("parses state=unacknowledged and minSeverityRank", () => spec.assertUnacknowledgedStateAndMinRankParse());
  it("refuses a negative, fractional or non-numeric minSeverityRank, and the summary refuses it", () =>
    spec.assertABadMinSeverityRankIsRefused());
  it("refuses a cursor beside state=unacknowledged", () => spec.assertACursorWithUnacknowledgedIsRefused());
  it("reads an empty minSeverityRank as absent and lower-cases locationId", () =>
    spec.assertAnEmptyRankIsAbsentAndALocationIdIsLowerCased());
});

describe("alarm list query — state=suppressed (F4.359 U5, plan Q4)", () => {
  it("parses state=suppressed, alone and beside a cursor", () => spec.assertSuppressedStateParsesWithAndWithoutACursor());
});
