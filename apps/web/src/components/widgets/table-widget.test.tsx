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
