// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aNullCellRendersAsAnEmDash,
  anEmptyDatasetSaysSoUnderItsHeader,
  anEmptyProjectionAsksTheAuthorToFixIt,
  noProjectionShowsEveryDeclaredColumn,
  theConfigProjectionReachesTheHeader,
  truncationIsAnnouncedOnlyWhenItHappened,
  theBenchmarkCoverageCellRendersTheRatio,
  theBenchmarkNullValueRendersTheEmDash,
  theBenchmarkTableReadsItsFourLabels,
  theWaterBalanceNullConsumedCellRendersTheEmDash,
  theWaterBalanceTableReadsItsSevenLabels,
} from "./table-widget.spec";

/** `F3.35` Stage B — Vitest wrapper for the table renderer (ADR 0014). */
afterEach(() => {
  cleanup();
});

describe("F3.35 Stage B — the table widget", () => {
  it("projects the author's chosen columns, in their order, into header and body", () => {
    theConfigProjectionReachesTheHeader();
  });

  it("shows every declared column when the config chose none", () => {
    noProjectionShowsEveryDeclaredColumn();
  });

  it("renders a null cell as an em dash", () => {
    aNullCellRendersAsAnEmDash();
  });

  it("says so under its header when the dataset resolved with no rows", () => {
    anEmptyDatasetSaysSoUnderItsHeader();
  });

  it("announces truncation only when the answer was cut off", () => {
    truncationIsAnnouncedOnlyWhenItHappened();
  });

  it("distinguishes a stale projection from an empty dataset", () => {
    anEmptyProjectionAsksTheAuthorToFixIt();
  });
});

describe("E4.2 — the sustainability benchmark table", () => {
  afterEach(() => {
    cleanup();
  });

  it("reads Site ID · Site · Value · Coverage", () => {
    theBenchmarkTableReadsItsFourLabels();
  });

  it("renders the coverage ratio string verbatim", () => {
    theBenchmarkCoverageCellRendersTheRatio();
  });

  it("renders the em dash for a site with no value, beside one that has one", () => {
    theBenchmarkNullValueRendersTheEmDash();
  });
});

describe("E4.3 — the water balance by site table", () => {
  afterEach(() => {
    cleanup();
  });

  it("reads Site ID · Site · Intake (KL) · Reuse (KL) · Discharge (KL) · Consumed or lost (KL) · Coverage", () => {
    theWaterBalanceTableReadsItsSevenLabels();
  });

  it("renders the em dash for a stale-discharge site's consumed cell, beside a populated sibling", () => {
    theWaterBalanceNullConsumedCellRendersTheEmDash();
  });
});
