import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import { mappingSheetPreviewDtoSchema } from "@bms/shared/contracts";
import type { MappingSheetPreviewDto } from "@bms/shared";

import * as assetPointsApi from "../../api/admin/asset-points";
import { MAPPING_SHEET_ERROR_LABELS } from "../../lib/mapping-sheet-preview";
import { MappingSheetPanel } from "./mapping-sheet-panel";

/**
 * `F2.7` / ADR 0056 decisions 6 and 7 — the mapping-sheet panel.
 *
 * Two claims, and they are the two the panel exists to hold:
 *
 * - **Every problem is renderable.** A row-level error names an Excel row, a
 *   column, a code and a message; the panel has to show all four, because a
 *   person fixing a sheet needs the cell, and the code alone is not English.
 *   The two fixture errors sit on **different rows** on purpose — the panel
 *   groups by row, so two problems on one row would make "two lines each
 *   carrying its row number" a weaker assertion than it looks.
 * - **Commit follows a preview of the same file.** The preview describes one
 *   `File`; a person who picks a second file and presses Commit would write
 *   what they never saw. This is `telemetry-import-page.tsx`'s rule, and it is
 *   asserted on the `File` object rather than on its name, because two files
 *   picked from the same directory carry the same name.
 *
 * The api module is stubbed with `vi.spyOn` (the `points-tab.spec.tsx`
 * pattern), so nothing here touches `fetch` and no upload is transported.
 * Assertions live here; `mapping-sheet-panel.test.tsx` is the Vitest entry
 * point and carries `@vitest-environment jsdom` (ADR 0014 / ADR 0042).
 */

const LOCATION_ID = "11111111-1111-4111-8111-111111111111";

/** A second location, for the case that changes location under a taken preview. */
const OTHER_LOCATION_ID = "33333333-3333-4333-8333-333333333333";

/** A preview with one create, one update and two problems on two different rows. */
const PREVIEW: MappingSheetPreviewDto = mappingSheetPreviewDtoSchema.parse({
  locationId: LOCATION_ID,
  totalRows: 6,
  creates: [
    {
      row: 2,
      assetCode: "TX01",
      pointKey: "kw",
      rtuCode: "RTU-1",
      sourceDataKey: "TX01_KW",
      unit: "kW",
      scaleMultiplier: null,
      scaleOffset: null,
      engMin: null,
      engMax: null,
      qualityPolicy: null,
      // Correction 36 — a pre-fill row whose `active` cell reads FALSE is
      // created inactive, so the create table has to show the flag.
      active: false,
    },
  ],
  updates: [
    {
      row: 3,
      assetPointId: "22222222-2222-4222-8222-222222222222",
      assetCode: "TX02",
      pointKey: "kw",
      changes: [{ field: "scaleMultiplier", from: null, to: 0.1 }],
    },
  ],
  unchanged: 1,
  untouchedSuggestions: 1,
  errors: [
    { row: 4, column: "rtu_code", code: "rtu_not_found", message: "No active RTU 'RTU-9' here" },
    { row: 5, column: "eng_min", code: "eng_range_inverted", message: "eng_max 100 (inherited from the template)" },
  ],
});

/**
 * No default argument: `renderPanel(undefined)` has to mean "no location
 * chosen". Returns the `rerender` the location-change case needs, bound to the
 * same client so the second render is the same mounted tree.
 */
function renderPanel(locationId: string | undefined): (next: string | undefined) => void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MappingSheetPanel locationId={locationId} />
    </QueryClientProvider>,
  );
  return (next) =>
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <MappingSheetPanel locationId={next} />
      </QueryClientProvider>,
    );
}

/** A `.csv` so `userEvent.upload` accepts it against `accept=".xlsx,.csv"`. */
function sheetFile(name: string): File {
  return new File(["asset_code,point_key\n"], name, { type: "text/csv" });
}

async function chooseFile(file: File): Promise<void> {
  const input = screen.getByLabelText("Mapping sheet file");
  await userEvent.upload(input, file);
}

function commitButton(): HTMLElement {
  return screen.getByRole("button", { name: "Commit" });
}

/**
 * Case 1 — a preview's two problems render as two lines, each carrying the
 * Excel row, the column, the label and the server's message.
 */
export async function everyProblemNamesItsCellAndItsReason(): Promise<void> {
  vi.spyOn(assetPointsApi, "previewMappingSheet").mockResolvedValue(PREVIEW);
  renderPanel(LOCATION_ID);

  await chooseFile(sheetFile("mappings.csv"));
  await userEvent.click(screen.getByRole("button", { name: "Preview" }));

  const table = await screen.findByRole("table", { name: "Problems" });
  const rows = within(table).getAllByRole("row").slice(1);
  expect(rows).toHaveLength(2);

  expect(rows[0].textContent).toContain("4");
  expect(rows[0].textContent).toContain("rtu_code");
  expect(rows[0].textContent).toContain(MAPPING_SHEET_ERROR_LABELS.rtu_not_found);
  expect(rows[0].textContent).toContain("No active RTU 'RTU-9' here");

  expect(rows[1].textContent).toContain("5");
  expect(rows[1].textContent).toContain("eng_min");
  expect(rows[1].textContent).toContain(MAPPING_SHEET_ERROR_LABELS.eng_range_inverted);
  expect(rows[1].textContent).toContain("eng_max 100 (inherited from the template)");

  // The create row's `active` flag, which correction 36 makes a real value.
  const creates = screen.getByRole("table", { name: "Rows to create" });
  expect(within(creates).getAllByRole("row")[1]?.textContent).toContain("Inactive");
}

/**
 * Case 2 — Commit is enabled only by a preview of the file that is currently
 * chosen, and picking another file takes it away again.
 */
export async function commitFollowsAPreviewOfTheSameFile(): Promise<void> {
  const preview = vi.spyOn(assetPointsApi, "previewMappingSheet").mockResolvedValue(PREVIEW);
  const commit = vi.spyOn(assetPointsApi, "commitMappingSheet");
  renderPanel(LOCATION_ID);

  const first = sheetFile("mappings.csv");
  await chooseFile(first);
  expect(commitButton()).toBeDisabled();

  await userEvent.click(screen.getByRole("button", { name: "Preview" }));
  await waitFor(() => expect(commitButton()).toBeEnabled());
  expect(preview).toHaveBeenCalledWith(LOCATION_ID, first);

  // A second file — same shape, different object, as a re-export would be.
  await chooseFile(sheetFile("mappings.csv"));
  await waitFor(() => expect(commitButton()).toBeDisabled());
  expect(screen.queryByRole("table", { name: "Problems" })).toBeNull();
  expect(commit).not.toHaveBeenCalled();
}

/**
 * Case 3 — with no location chosen there is nothing to export and nothing to
 * import into: the sheet is a location document (ADR 0056 decision 6), and the
 * route would answer 400 without one.
 */
export function withoutALocationTheExportIsDisabledAndSaysWhy(): void {
  renderPanel(undefined);

  expect(screen.getByRole("button", { name: "Download mapping sheet" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Preview" })).toBeDisabled();
  expect(screen.getByText(/choose a location/i)).toBeInTheDocument();
}

/**
 * Case 4 — a preview belongs to the location it was taken against (post-merge
 * code review, finding 3).
 *
 * Commit was guarded on the `File` alone, and the page mounted the panel with
 * no `key`, so choosing another location in the filter bar kept the preview of
 * the first one on screen with Commit still enabled: pressing it would have
 * posted the file to the **new** location's commit route and written rows
 * nobody had previewed. The panel now also compares the preview DTO's own
 * `locationId`, and the page keys the panel by location so the state is dropped
 * outright; either alone would close the hole, and both are cheap.
 */
export async function aPreviewDoesNotSurviveALocationChange(): Promise<void> {
  vi.spyOn(assetPointsApi, "previewMappingSheet").mockResolvedValue(PREVIEW);
  const commit = vi.spyOn(assetPointsApi, "commitMappingSheet");
  const rerender = renderPanel(LOCATION_ID);

  await chooseFile(sheetFile("mappings.csv"));
  await userEvent.click(screen.getByRole("button", { name: "Preview" }));
  await waitFor(() => expect(commitButton()).toBeEnabled());
  expect(screen.getByRole("table", { name: "Rows to create" })).toBeInTheDocument();

  // The filter bar moves to another location; the file input keeps its file.
  rerender(OTHER_LOCATION_ID);

  await waitFor(() => expect(commitButton()).toBeDisabled());
  expect(screen.queryByRole("table", { name: "Rows to create" })).toBeNull();
  expect(screen.queryByRole("table", { name: "Rows to update" })).toBeNull();
  expect(screen.queryByRole("table", { name: "Problems" })).toBeNull();
  expect(commit).not.toHaveBeenCalled();
}
