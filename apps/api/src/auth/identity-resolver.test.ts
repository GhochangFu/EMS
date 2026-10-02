import { describe, it } from "vitest";

import {
  assertACopiedPayloadMissesTheMemo,
  assertLinkRefusesAnUnverifiedEmail,
  assertLinkThrowsOnTwoRows,
  assertLinkWithNoRowReReadsAndReturnsNull,
  assertLinkWithNoRowReturnsAConcurrentLink,
  assertLinkWithOneRowReturnsIt,
  assertLocalNonUuidSubjectIsNullWithoutAQuery,
  assertLocalSelectsById,
  assertMemoSkipsTheDbOnTheSecondCall,
  assertOidcSelectsBySubjectNotEmail,
  assertResolveActorIdReadsTheMemo,
} from "./identity-resolver.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("resolveIdentity (F3.78, ADR 0089 decision 4)", () => {
  it("OIDC selects by oidc_subject and not by email", async () => {
    await assertOidcSelectsBySubjectNotEmail();
  });

  it("local selects by id", async () => {
    await assertLocalSelectsById();
  });

  it("local mode answers null for a non-uuid subject without a query", async () => {
    await assertLocalNonUuidSubjectIsNullWithoutAQuery();
  });

  it("the memo skips the db on the second call", async () => {
    await assertMemoSkipsTheDbOnTheSecondCall();
  });

  it("a copied payload misses the memo", async () => {
    await assertACopiedPayloadMissesTheMemo();
  });

  it("resolveActorId reads the memo the guard filled", async () => {
    await assertResolveActorIdReadsTheMemo();
  });
});

describe("linkIdentity (F3.78, ADR 0089 decision 4)", () => {
  it("on one row returns it without a re-read", async () => {
    await assertLinkWithOneRowReturnsIt();
  });

  it("on 0 rows re-reads by subject and returns null when nothing is there", async () => {
    await assertLinkWithNoRowReReadsAndReturnsNull();
  });

  it("on 0 rows returns the row a concurrent link produced", async () => {
    await assertLinkWithNoRowReturnsAConcurrentLink();
  });

  it("throws on 2 rows", async () => {
    await assertLinkThrowsOnTwoRows();
  });

  it("does not run for an unverified email", async () => {
    await assertLinkRefusesAnUnverifiedEmail();
  });
});
