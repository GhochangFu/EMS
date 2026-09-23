import { describe, it } from "vitest";

import {
  byLocationOnAnEmptyScopeBuildsNoSql,
  everyEntryOnAnEmptyScopeBuildsNoSql,
  totalOnAnEmptyScopeBuildsNoSql,
  waterBalanceOnAnEmptyScopeBuildsNoSql,
} from "./metric-catalog.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E4.2 sweep — the catalog's resolvers on an empty scope (no database)", () => {
  it("sustainability.total answers 0/0, null, no unit, no currency before any SQL", async () => {
    await totalOnAnEmptyScopeBuildsNoSql();
  });

  it("sustainability.by_location answers an empty dataset before any SQL (the control)", async () => {
    await byLocationOnAnEmptyScopeBuildsNoSql();
  });

  it("water.balance answers an empty seven-column dataset before any SQL (E4.3)", async () => {
    await waterBalanceOnAnEmptyScopeBuildsNoSql();
  });

  it("every catalog entry answers an empty scope before any SQL (the sentence over RESOLVERS)", async () => {
    await everyEntryOnAnEmptyScopeBuildsNoSql();
  });
});
