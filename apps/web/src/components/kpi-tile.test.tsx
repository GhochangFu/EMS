// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aNonStaleReadyTileShowsNoCaption,
  aReadyTileWithAValueShowsNoAlert,
  aStaleErrorTileShowsTheCaptionBesideTheAlert,
  aStaleLoadingTileShowsTheCaption,
  aStaleReadyTileShowsTheCaption,
  anErrorTileIsAnnouncedAsAnAlert,
} from "./kpi-tile.spec";

/**
 * `F4.164` U1 — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); the jsdom docblock is here because this is the file Vitest
 * collects (ADR 0042 decision 2).
 */
describe("F4.164 U1 — KpiTile: the error is an alert; the caption follows the ring", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("announces the error branch as an alert", () => {
    anErrorTileIsAnnouncedAsAnAlert();
  });

  it("shows no alert and the value for a ready tile", () => {
    aReadyTileWithAValueShowsNoAlert();
  });

  it("shows the stale caption for a loading tile", () => {
    aStaleLoadingTileShowsTheCaption();
  });

  it("shows the stale caption beside the alert for an error tile", () => {
    aStaleErrorTileShowsTheCaptionBesideTheAlert();
  });

  it("shows the stale caption for a ready tile", () => {
    aStaleReadyTileShowsTheCaption();
  });

  it("shows no caption for a non-stale ready tile", () => {
    aNonStaleReadyTileShowsNoCaption();
  });
});
