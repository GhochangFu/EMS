// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, it, vi } from "vitest";

import {
  aStaleForecastShowsThePill,
  anUnreadableTimeIsADash,
  anotherDayCarriesTheDate,
  theCaptionNamesTheIssueTimeInTheSiteZoneTheModelAndAdvisory,
} from "./forecast-caption.spec";

/** Vitest entry point (ADR 0014). `TZ=America/St_Johns`: a time in the browser's zone fails. */
beforeAll(() => {
  vi.stubEnv("TZ", "America/St_Johns");
});
afterAll(() => {
  vi.unstubAllEnvs();
});
afterEach(() => {
  cleanup();
});

describe("E1.4a — the forecast caption", () => {
  it("names the issue time in the site zone, the model and 'advisory'", () =>
    theCaptionNamesTheIssueTimeInTheSiteZoneTheModelAndAdvisory());
  it("a stale forecast shows the pill", () => aStaleForecastShowsThePill());
  it("another day carries the date", () => anotherDayCarriesTheDate());
  it("an unreadable time is a dash, never a throw", () => anUnreadableTimeIsADash());
});
