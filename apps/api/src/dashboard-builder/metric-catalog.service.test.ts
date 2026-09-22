import { describe, it } from "vitest";

import {
  byLocationOnAnEmptyScopeBuildsNoSql,
  everyEntryOnAnEmptyScopeBuildsNoSql,
  totalOnAnEmptyScopeBuildsNoSql,
} from "./metric-catalog.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E4.2 sweep — the catalog's resolvers on an empty scope (no database)", () => {
  it("sustainability.total answers 0/0, null, no unit, no currency before any SQL", async () => {
    await totalOnAnEmptyScopeBuildsNoSql();
  });

  it("sustainability.by_location answers an empty dataset before any SQL (the control)", async () => {
    await byLocationOnAnEmptyScopeBuildsNoSql();
  });

  it("every catalog entry answers an empty scope before any SQL (the sentence over RESOLVERS)", async () => {
    await everyEntryOnAnEmptyScopeBuildsNoSql();
  });
});
