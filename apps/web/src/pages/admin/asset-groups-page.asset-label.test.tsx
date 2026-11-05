// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aMemberOnAnRtuIsNamedByIt,
  aMemberWithoutAnRtuIsNamedByItsLocation,
  theWherePartWrapsAndIsNeverTruncated,
} from "./asset-groups-page.asset-label.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042 decision 2). */
describe("F4.316 PR 5 — the asset groups page names each member by its label (ADR 0111)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("names a member on an RTU <code> · <RTU>", async () => {
    await aMemberOnAnRtuIsNamedByIt();
  });

  it("names a member with no RTU <code> · <location>", async () => {
    await aMemberWithoutAnRtuIsNamedByItsLocation();
  });

  it("wraps the where part and never truncates it", async () => {
    await theWherePartWrapsAndIsNeverTruncated();
  });
});
