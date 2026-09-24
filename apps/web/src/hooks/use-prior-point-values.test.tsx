// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  fetchesWithRefsAndExposesByRef,
  isDisabledWithZeroRefs,
  previousValuesStayVisibleWhileTheNextMinuteFetches,
  queryKeyChangesWhenTheMinuteChanges,
  reRendersInsideOneMinuteFetchOnce,
} from "./use-prior-point-values.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.28 usePriorPointValues", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("is disabled with zero refs — no fetch", async () => {
    await isDisabledWithZeroRefs();
  });

  it("fetches with refs and exposes the values by ref", async () => {
    await fetchesWithRefsAndExposesByRef();
  });

  it("changes its query key when the floored minute changes", async () => {
    await queryKeyChangesWhenTheMinuteChanges();
  });

  it("fetches once across re-renders inside the same minute", async () => {
    await reRendersInsideOneMinuteFetchOnce();
  });

  it("keeps the previous minute's values visible while the next minute fetches", async () => {
    await previousValuesStayVisibleWhileTheNextMinuteFetches();
  });
});
