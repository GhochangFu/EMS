// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";

import {
  badActorsCacheOptions,
  badActorsEnterpriseKey,
  badActorsKeyAndThunk,
  badActorsOffWhenDisabled,
  badActorsTwoScopesTwoKeys,
  inputsDoesNotRetry,
  inputsKeyAndFetch,
  inputsOffForAnEmptyId,
  noArgumentIsTheEnterpriseSummary,
  theFilterReachesTheFetcher,
  theKeyCarriesTheLocationId,
  theKeyCarriesTheOrganizationId,
} from "./use-asset-health.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.72 U1 useHealthSummary filter and key", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hands the filter to the fetcher whole", async () => {
    await theFilterReachesTheFetcher();
  });

  it("fetches again for another organization on the same client", async () => {
    await theKeyCarriesTheOrganizationId();
  });

  it("fetches again for another location on the same client", async () => {
    await theKeyCarriesTheLocationId();
  });

  it("reads the enterprise summary with no argument", async () => {
    await noArgumentIsTheEnterpriseSummary();
  });
});

describe("E1.8b T2.2 useAssetHealthInputs and useHealthBadActors", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keys the inputs read by the asset id and fetches it", async () => {
    await inputsKeyAndFetch();
  });

  it("makes no inputs request for an empty id", async () => {
    await inputsOffForAnEmptyId();
  });

  it("does not retry a rejected inputs read", async () => {
    await inputsDoesNotRetry();
  });

  it("keys the bad-actors read by both scope fields and hands the filter to the fetcher", async () => {
    await badActorsKeyAndThunk();
  });

  it("keys the enterprise bad-actors read with two nulls", async () => {
    await badActorsEnterpriseKey();
  });

  it("makes no bad-actors request when disabled", async () => {
    await badActorsOffWhenDisabled();
  });

  it("never lets two scopes share a bad-actors key", async () => {
    await badActorsTwoScopesTwoKeys();
  });

  it("keeps the bad-actors read fresh for 5 minutes, off window focus, with no retry", async () => {
    await badActorsCacheOptions();
  });
});
