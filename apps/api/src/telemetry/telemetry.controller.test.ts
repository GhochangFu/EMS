import { describe, it } from "vitest";

import {
  assertAMalformedPointRefIsABadRequest,
  assertAPointInsideScopeIsRead,
  assertAPointOutsideScopeIsRefusedBeforeAnyRead,
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
