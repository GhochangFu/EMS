// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aChangeIsUndoneByBack,
  anOptionsErrorLeavesTheUrl,
  anUnknownIdIsRemovedFromTheUrl,
  theListWaitsOnlyForAScopedUrl,
  theUrlIsTheFilter,
} from "./use-scope-filter.spec";

/** `F4.361` U6 — the scope filter in the URL. Assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.361 useScopeFilter", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
  it("reads the filter from the URL", () => theUrlIsTheFilter());
  it("removes an unknown id from the URL by a replace", () => anUnknownIdIsRemovedFromTheUrl());
  it("pushes a change, and Back undoes it", () => aChangeIsUndoneByBack());
  it("leaves the URL and reports unavailable when the options fail", () => anOptionsErrorLeavesTheUrl());
  it("waits for the options only when the URL names a scope", () => theListWaitsOnlyForAScopedUrl());
});
