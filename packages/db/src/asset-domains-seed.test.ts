import { describe, it } from "vitest";

import {
  assertDomainsAreSeededBeforeTheKeysFiledUnderThem,
  assertReSeedingIsIdempotentAndNeverOverwrites,
  assertTheCallSitsOutsideAnyTenantBracket,
  assertThePackDeclaresExactlyTheRuledRow,
} from "./asset-domains-seed.spec";

describe("E5.2 — the mechanical domain is the first a pack adds through the seed", () => {
  it("is idempotent on a re-seed and never overwrites a retirement or a relabel", () => {
    assertReSeedingIsIdempotentAndNeverOverwrites();
  });

  it("declares exactly the row ADR 0053 decision 2 rules", () => {
    assertThePackDeclaresExactlyTheRuledRow();
  });

  it("seeds the domain before the point keys filed under it", () => {
    assertDomainsAreSeededBeforeTheKeysFiledUnderThem();
  });

  it("runs outside every tenant bracket, because the table carries no policy", () => {
    assertTheCallSitsOutsideAnyTenantBracket();
  });
});
