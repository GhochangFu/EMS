import { describe, it } from "vitest";

import { runProjectColumnsTests, runTableCellTextTests } from "./table-widget-cells.spec";

/** `F3.35` Stage B — Vitest wrapper for the table renderer's pure half (ADR 0014). */
describe("F3.35 Stage B — the column projection", () => {
  it("honours the author's chosen order and drops names the dataset does not declare", () => {
    runProjectColumnsTests();
  });
});

describe("F3.35 Stage B — a table cell", () => {
  it("renders absence as an em dash and keeps false, zero and the empty string visible", () => {
    runTableCellTextTests();
  });
});
