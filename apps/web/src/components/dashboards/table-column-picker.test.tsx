// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aMetricBindingRendersNothing,
  offersExactlyTheDeclaredColumns,
  theArrowsReorderTheProjection,
  theEmptyStateSaysEveryColumn,
  tickingAppendsInTheAuthorsOrder,
  untickingRemovesOnlyThatColumn,
} from "./table-column-picker.spec";

/**
 * `F3.35` Stage B — Vitest wrapper for the column picker (ADR 0014).
 *
 * `cleanup` after each, because every assertion renders into the same document and
 * `getByRole` would otherwise find the previous test's checkboxes.
 */
afterEach(() => {
  cleanup();
});

describe("F3.35 Stage B — the table column picker", () => {
  it("offers exactly the columns the bound dataset declares", () => {
    offersExactlyTheDeclaredColumns();
  });

  it("says nothing chosen means every column", () => {
    theEmptyStateSaysEveryColumn();
  });

  it("appends a ticked column in the author's order rather than the declared order", () => {
    tickingAppendsInTheAuthorsOrder();
  });

  it("removes only the un-ticked column", () => {
    untickingRemovesOnlyThatColumn();
  });

  it("reorders the projection, and disables the arrows at the ends", () => {
    theArrowsReorderTheProjection();
  });

  it("renders nothing for a metric binding instead of throwing", () => {
    aMetricBindingRendersNothing();
  });
});
