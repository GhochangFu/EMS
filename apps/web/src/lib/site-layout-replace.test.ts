import { describe, it } from "vitest";

import {
  noEditReadsAsNoRecordedEdit,
  theFlagNamesTheActor,
  theFlagOmitsAnAbsentActor,
  theHeldCopyReadsAsCodeAndVersion,
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
