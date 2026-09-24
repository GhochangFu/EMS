import { describe, it } from "vitest";

import {
  assertAMalformedPointRefIsABadRequest,
  assertAPointInsideScopeIsRead,
  assertAPointOutsideScopeIsRefusedBeforeAnyRead,
  assertAtInstantAdminPasses,
  assertAtInstantHandsTheDecodedPairsToTheService,
  assertAtInstantKeepsRequestOrder,
  assertAtInstantMalformedRefIsABadRequest,
  assertAtInstantNonUuidAssetIsABadRequest,
  assertAtInstantRefusalRunsBeforeTheRead,
  assertAtInstantRefusesMoreThanFiftyRefs,
  assertAtInstantRefusesWhenOneRefIsForeign,
  assertQueryBoundsAreEnforced,
  assertTheCompareFlagReadsItsOwnNegative,
  assertTheDefaultsAreATileRequest,
} from "./telemetry.controller.spec";

/** `F3.35` Stage A — Vitest wrapper for the aggregate endpoint's assertions (ADR 0014). */
describe("F3.35 Stage A — the aggregate endpoint's access check", () => {
  it("refuses a point outside the caller's scope BEFORE reading it", async () => {
    await assertAPointOutsideScopeIsRefusedBeforeAnyRead();
  });

  it("reads a point inside the caller's scope, so the guard is not simply always-refuse", async () => {
    await assertAPointInsideScopeIsRead();
  });

  it("answers a malformed point reference with a 400, not a 500", async () => {
    await assertAMalformedPointRefIsABadRequest();
  });
});

describe("F3.35 Stage A — the aggregate endpoint's query contract", () => {
  it("refuses a window past the bound and a function outside the vocabulary", async () => {
    await assertQueryBoundsAreEnforced();
  });

  it("reads ?compare=false as false, which z.coerce.boolean would not", async () => {
    await assertTheCompareFlagReadsItsOwnNegative();
  });

  it("defaults to a one-day tile request that asks for no buckets", async () => {
    await assertTheDefaultsAreATileRequest();
  });
});

describe("F3.28 — the at-instant endpoint (ADR 0074 decision 2)", () => {
  it("refuses the whole request with a 403 when one of two refs is foreign", async () => {
    await assertAtInstantRefusesWhenOneRefIsForeign();
  });

  it("does not call the service when a ref is foreign", async () => {
    await assertAtInstantRefusalRunsBeforeTheRead();
  });

  it("answers a ref with no separator with a 400", async () => {
    await assertAtInstantMalformedRefIsABadRequest();
  });

  it("answers a non-UUID asset id with a 400, not a 500 at the uuid cast", async () => {
    await assertAtInstantNonUuidAssetIsABadRequest();
  });

  it("answers 51 refs with a 400", async () => {
    await assertAtInstantRefusesMoreThanFiftyRefs();
  });

  it("lets an unrestricted admin read any asset", async () => {
    await assertAtInstantAdminPasses();
  });

  it("keeps request order and echoes each ref and at as sent", async () => {
    await assertAtInstantKeepsRequestOrder();
  });

  it("hands the decoded pairs and the parsed instant to the service", async () => {
    await assertAtInstantHandsTheDecodedPairsToTheService();
  });
});
