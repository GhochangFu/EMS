// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aLeftOutAssetOfAnotherDomainDoesNotLiftTheFilter,
  aSharedDomainFiltersTheKeys,
  mixedDomainsListEveryKey,
  newKeyIsStillOfferedUnderASharedDomain,
} from "./assets-page.calc-batch-key-picker.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042 decision 2). */
describe("F4.313 follow-up — the bulk calculated-point wizard lists the selected assets' domain first", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("filters the keys by the domain every selected asset shares", async () => {
    await aSharedDomainFiltersTheKeys();
  });

  it("lists every key when the selected assets' domains differ", async () => {
    await mixedDomainsListEveryKey();
  });

  it("a left-out asset of another domain does not lift the eligible assets' shared domain", async () => {
    await aLeftOutAssetOfAnotherDomainDoesNotLiftTheFilter();
  });

  it("New key is still offered under a shared domain", async () => {
    await newKeyIsStillOfferedUnderASharedDomain();
  });
});
