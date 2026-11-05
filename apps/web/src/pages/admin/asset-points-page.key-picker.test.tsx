// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aKeyTheAssetHasStaysOutByDefault,
  aKeyTheAssetHasStaysOutUnderShowAll,
  newKeyIsStillOfferedByDefault,
  showAllListsACrossDomainKey,
  theDefaultListsOnlyTheAssetsDomain,
  theSearchNarrowsByCode,
  theSearchNarrowsByName,
} from "./asset-points-page.key-picker.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042 decision 2). */
describe("F4.313 follow-up — the Add calculated point key picker lists the asset's domain first", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("by default lists only the keys of the asset's domain", async () => {
    await theDefaultListsOnlyTheAssetsDomain();
  });

  it("Show all keys lists a key of another domain", async () => {
    await showAllListsACrossDomainKey();
  });

  it("the search narrows the list by code", async () => {
    await theSearchNarrowsByCode();
  });

  it("the search narrows the list by name", async () => {
    await theSearchNarrowsByName();
  });

  it("a key the asset already has stays out by default", async () => {
    await aKeyTheAssetHasStaysOutByDefault();
  });

  it("a key the asset already has stays out under Show all keys", async () => {
    await aKeyTheAssetHasStaysOutUnderShowAll();
  });

  it("New key is still offered in the domain-first default", async () => {
    await newKeyIsStillOfferedByDefault();
  });
});
