import { afterEach, describe, it, vi } from "vitest";

import {
  anUnknownAssetReadsNull,
  anUnknownLocationReadsNull,
  anUnknownPointReadsNull,
  anUnknownRtuReadsNull,
  theAssetCardReadsTheListedRow,
  theAssetTemplateCardReadsTheVersionsFields,
  theLocationCardReadsTheListedRow,
  thePointCardReadsTheStoredRow,
  theRtuCardReadsTheListedRow,
  theViewCardReadsTheStoredSetting,
} from "./copilot-current.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.86 PR 3d — an edit card's Now values", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads a site's stored Control Room view for the view card", () => theViewCardReadsTheStoredSetting());
});

describe("F3.86 PR 3a review — the location and RTU edit cards' Now values", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps the listed location row to the update body's fields", () => theLocationCardReadsTheListedRow());
  it("reads null for a location the list does not hold", () => anUnknownLocationReadsNull());
  it("maps the listed RTU row to the update body's fields", () => theRtuCardReadsTheListedRow());
  it("reads null for an RTU the list does not hold", () => anUnknownRtuReadsNull());
});

describe("F3.86 PR 3b — the asset and point-mapping edit cards' Now values", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps the listed asset row to the update body's fields", () => theAssetCardReadsTheListedRow());
  it("reads null for an asset the list does not hold", () => anUnknownAssetReadsNull());
  it("maps the stored point row to the update body's fields, not the template's", () => thePointCardReadsTheStoredRow());
  it("reads null for a point mapping the list does not hold", () => anUnknownPointReadsNull());
});

describe("F4.246 — the asset-template edit card's Now values", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps the version's detail read to the update body's fields, points in the write shape", () =>
    theAssetTemplateCardReadsTheVersionsFields());
});
