import { describe, it } from "vitest";

import {
  areaSeriesIsLineWithAreaStyle,
  catalogCardinalityIsImportedNotRestated,
  catalogDefaultSizesFitTheGrid,
  catalogLabelsAreNonEmpty,
  chartSeriesLabelsArePinned,
  toneColorsCoverAllFourTones,
} from "./widget-catalog.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("widget-catalog", () => {
  it("imports point cardinality from @bms/shared rather than restating it", () => {
    catalogCardinalityIsImportedNotRestated();
  });

  it("keeps every default size inside the grid bounds check", () => {
    catalogDefaultSizesFitTheGrid();
  });

  it("gives every widget type a non-empty label", () => {
    catalogLabelsAreNonEmpty();
  });

  it("pins the four chart series labels literally", () => {
    chartSeriesLabelsArePinned();
  });

  it("maps the filled trend to a line series with areaStyle, not a separate series type", () => {
    areaSeriesIsLineWithAreaStyle();
  });

  it("gives every widget tone a hex colour", () => {
    toneColorsCoverAllFourTones();
  });
});
