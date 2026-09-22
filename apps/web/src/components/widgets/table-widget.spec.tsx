import { render, screen, within } from "@testing-library/react";
import { expect } from "vitest";

import type { DatasetRow } from "./dashboard-widget";
import { TableWidget } from "./table-widget";

/**
 * `F3.35` Stage B — the `table` renderer.
 *
 * Assertions live here; `table-widget.test.tsx` is the Vitest entry point and carries the
 * `@vitest-environment jsdom` docblock (ADR 0014, ADR 0042 decision 2).
 *
 * **This file exists because the correctness review found the component had no test at all, and
 * named the mutation that proved it.** The only render of `TableWidget` was
 * `dashboard-widget.spec.tsx`'s catalog walk, which passes the SCALAR `WidgetData` arm — so
 * `isRowsData` was false, the component received no columns, and every render landed in the
 * "No columns to show" branch. The `<thead>`, the row map, the `tableCellText` wiring and the
 * truncated notice were executed by nothing.
 *
 * The mutation that stayed green: replace `projectColumns(columns, config.columns)` with
 * `columns`. ADR 0048 decision 2's entire column picker then has no effect on any card,
 * `projectColumns` still passes its own unit tests, and no assertion fails. The first test below
 * is written to fail against exactly that.
 */

const COLUMNS = ["assetCode", "assetName", "severity", "message", "raisedAt"];

/**
 * The same five as an operator reads them. Written out rather than mapped through
 * `metricCatalogColumnLabel`, so this pins the §5 wording instead of agreeing with whatever the
 * map happens to say — a test that mapped would pass against a map returning the raw names.
 */
const COLUMN_LABELS = ["Asset ID", "Asset", "Severity", "Message", "Raised"];

const ROWS: DatasetRow[] = [
  {
    assetCode: "RO-01",
    assetName: "RO Feed Pump",
    severity: "critical",
    message: "Feed pressure above design limit",
    raisedAt: "2026-01-01T00:05:00.000Z",
  },
  {
    assetCode: "UPS-02",
    assetName: "UPS B",
    severity: "warning",
    // A real absence, and the one cell shape a table must not render as blank or as "null".
    message: null,
    raisedAt: "2026-01-01T00:06:00.000Z",
  },
];

const headerTexts = (): string[] =>
  [...screen.getAllByRole("columnheader")].map((cell) => cell.textContent ?? "");

/**
 * The config's projection reaches the rendered header, in the author's order.
 *
 * **Fails against `const shown = columns`** — the declared order is
 * `assetCode, assetName, severity, …`, so a renderer ignoring the config would produce five
 * headers starting with `assetCode`, not two starting with `severity`.
 */
export function theConfigProjectionReachesTheHeader(): void {
  render(
    <TableWidget
      title="Active alarms"
      status="ready"
      config={{ columns: ["severity", "assetCode"] }}
      columns={COLUMNS}
      rows={ROWS}
      truncated={false}
    />,
  );

  // The LABELS, in the author's chosen order — two claims in one assertion, both load-bearing.
  // The order is the column picker's whole output; the labels are AGENTS.md §5, because
  // `assetCode` is a field name and the Nexus mock heads its tables "WO ID" / "Area / Asset".
  expect(headerTexts()).toEqual(["Severity", "Asset ID"]);

  // And the BODY is projected too, not just the header — a renderer that headed two columns and
  // then emitted five cells per row would pass a header-only assertion.
  const bodyRows = screen.getAllByRole("row").slice(1);
  expect(bodyRows.length).toBe(2);
  for (const row of bodyRows) {
    expect(within(row).getAllByRole("cell").length).toBe(2);
  }
  expect(within(bodyRows[0] as HTMLElement).getAllByRole("cell")[0]?.textContent).toBe("critical");
}

/** No projection means every declared column — the state a table is created in. */
export function noProjectionShowsEveryDeclaredColumn(): void {
  render(
    <TableWidget
      title="Active alarms"
      status="ready"
      config={{}}
      columns={COLUMNS}
      rows={ROWS}
      truncated={false}
    />,
  );
  expect(headerTexts()).toEqual(COLUMN_LABELS);
}

/** A null cell renders as an em dash — never blank, never the string "null". */
export function aNullCellRendersAsAnEmDash(): void {
  render(
    <TableWidget
      title="Active alarms"
      status="ready"
      config={{ columns: ["message"] }}
      columns={COLUMNS}
      rows={ROWS}
      truncated={false}
    />,
  );

  const cells = screen.getAllByRole("cell").map((cell) => cell.textContent);
  expect(cells).toEqual(["Feed pressure above design limit", "—"]);
  expect(cells.some((text) => text === "null")).toBe(false);
}

/**
 * A dataset that resolved with no rows says so, rather than drawing a bare header.
 *
 * This is the state an unanswered resolve produces — `catalogWidgetData` gives the declared
 * columns and an empty row list — so it is the FIRST thing an author sees on every page load.
 */
export function anEmptyDatasetSaysSoUnderItsHeader(): void {
  render(
    <TableWidget
      title="Active alarms"
      status="ready"
      config={{}}
      columns={COLUMNS}
      rows={[]}
      truncated={false}
    />,
  );

  expect(headerTexts()).toEqual(COLUMN_LABELS);
  expect(screen.getByText(/Nothing to show right now/i)).toBeDefined();
}

/**
 * `truncated` is announced, because a card showing part of an answer must not look like the
 * whole one. Both directions, or a renderer that always announced it would pass.
 */
export function truncationIsAnnouncedOnlyWhenItHappened(): void {
  const { unmount } = render(
    <TableWidget
      title="Active alarms"
      status="ready"
      config={{}}
      columns={COLUMNS}
      rows={ROWS}
      truncated
    />,
  );
  expect(screen.getByText(/Showing the first 2 rows/i)).toBeDefined();
  unmount();

  render(
    <TableWidget
      title="Active alarms"
      status="ready"
      config={{}}
      columns={COLUMNS}
      rows={ROWS}
      truncated={false}
    />,
  );
  expect(screen.queryByText(/Showing the first/i)).toBeNull();
}

/**
 * Every chosen column gone from the dataset is the "edit this widget" state — and it must be
 * distinguishable from "resolved with no rows", which is not the author's problem to fix.
 */
export function anEmptyProjectionAsksTheAuthorToFixIt(): void {
  render(
    <TableWidget
      title="Active alarms"
      status="ready"
      config={{ columns: ["goneFromTheCatalog"] }}
      columns={COLUMNS}
      rows={ROWS}
      truncated={false}
    />,
  );

  expect(screen.getByText(/No columns to show/i)).toBeDefined();
  expect(screen.queryAllByRole("columnheader").length).toBe(0);
  // Not the empty-dataset wording — the two states have different remedies.
  expect(screen.queryByText(/Nothing to show right now/i)).toBeNull();
}

/**
 * `E4.2` U10, ADR 0072 decision 2 — the benchmark table.
 *
 * `sustainability.by_location` declares `locationCode · locationName · value ·
 * coverage`, and `coverage` is the string `"fresh/carrying"` because a dataset
 * cell is `string | number | boolean | null` and cannot carry an object (plan
 * OQ4). **No renderer code was written for this** — the claim is exactly that
 * the existing column labels and `tableCellText` already produce the right card,
 * and a claim of "needs no code" is worth nothing unless something renders it.
 */
const BY_LOCATION_COLUMNS = ["locationCode", "locationName", "value", "coverage"];

const BY_LOCATION_ROWS: DatasetRow[] = [
  { locationCode: "WC-01", locationName: "Western Cape", value: 1234.5, coverage: "4/6" },
  // A site with assets and no meters: the roll-up has nothing to report, which
  // is a null value rather than a zero (ADR 0072 decision 2 — `0/0`).
  { locationCode: "GP-02", locationName: "Gauteng", value: null, coverage: "0/0" },
];

/** The four §5 labels, written out rather than mapped — a test that mapped would
 * pass against a map returning the raw column names. */
export function theBenchmarkTableReadsItsFourLabels(): void {
  render(
    <TableWidget
      title="Benchmark"
      status="ready"
      config={{}}
      columns={BY_LOCATION_COLUMNS}
      rows={BY_LOCATION_ROWS}
      truncated={false}
    />,
  );

  expect(headerTexts()).toEqual(["Site ID", "Site", "Value", "Coverage"]);
}

/** The coverage cell renders the `"n/m"` string verbatim. */
export function theBenchmarkCoverageCellRendersTheRatio(): void {
  render(
    <TableWidget
      title="Benchmark"
      status="ready"
      config={{ columns: ["coverage"] }}
      columns={BY_LOCATION_COLUMNS}
      rows={BY_LOCATION_ROWS}
      truncated={false}
    />,
  );

  expect(screen.getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["4/6", "0/0"]);
}

/** A site with no value renders the em dash, beside a site that has one — the
 * adjacent positive control, in the same render. */
export function theBenchmarkNullValueRendersTheEmDash(): void {
  render(
    <TableWidget
      title="Benchmark"
      status="ready"
      config={{ columns: ["value"] }}
      columns={BY_LOCATION_COLUMNS}
      rows={BY_LOCATION_ROWS}
      truncated={false}
    />,
  );

  expect(screen.getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["1234.5", "—"]);
}
