import { describe, it } from "vitest";

import {
  noEditReadsAsNoRecordedEdit,
  theFlagNamesTheActor,
  theFlagOmitsAnAbsentActor,
  theHeldCopyReadsAsCodeAndVersion,
  theIdKeyedReadsAreNamed,
  theReplaceFiltersSkipTheOldIdsReads,
} from "./site-layout-replace.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6). */
describe("F4.320 PR 2 the Replace edit flag (ADR 0087 Amendment 4 decision 9)", () => {
  it("E1 names the count, the date and the actor", () => {
    theFlagNamesTheActor();
  });

  it("E2 omits 'by' when the actor is absent", () => {
    theFlagOmitsAnAbsentActor();
  });

  it("E3 reads 'No recorded edit since the copy' with no edit", () => {
    noEditReadsAsNoRecordedEdit();
  });

  it("E4 names the held copy by code and version", () => {
    theHeldCopyReadsAsCodeAndVersion();
  });
});

describe("F4.320 follow-up: the refresh after a Replace skips the deleted dashboard's reads", () => {
  it("R1 re-reads the slug and list reads, never the old id's site-widgets, catalog-values or mimic-nodes", async () => {
    await theReplaceFiltersSkipTheOldIdsReads();
  });

  it("R2 names the id-keyed reads, and every other dashboards read is stale", () => {
    theIdKeyedReadsAreNamed();
  });
});
