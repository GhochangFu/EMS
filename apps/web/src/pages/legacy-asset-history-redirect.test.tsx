// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import { anEncodedSlashStaysInsideTheHistoryPath, theLegacyPathLandsWithItsQuery } from "./legacy-asset-history-redirect.spec";

/** Vitest entry point (ADR 0014, ADR 0042 decision 2). */
afterEach(() => {
  cleanup();
});

describe("E1.4b — the legacy asset history redirect", () => {
  it("lands on /asset-history/:assetId with its query", () => theLegacyPathLandsWithItsQuery());
  it("keeps an encoded slash inside the history path", () => anEncodedSlashStaysInsideTheHistoryPath());
});
