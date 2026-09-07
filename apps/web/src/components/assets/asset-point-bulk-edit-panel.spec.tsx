import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import { MAX_ASSET_POINT_BULK_IDS } from "@bms/shared";

import * as assetPointsApi from "../../api/admin/asset-points";
import { AssetPointBulkEditPanel } from "./asset-point-bulk-edit-panel";

/**
 * `F2.7` / ADR 0056 decision 8 — the "Edit selected" panel.
 *
 * Two claims:
 *
 * - **Nothing is sent by accident.** Apply is unavailable until a field is
 *   ticked, because the request writes to every selected row and audits every
 *   one of them; the API refuses an empty patch for the same reason.
 * - **The request carries exactly the ticked field.** The assertion is a whole
 *   -object comparison, so a panel that helpfully sent `unit: null` beside the
 *   multiplier — clearing a column nobody asked about on up to 500 rows —
 *   fails here rather than in front of an operator.
 *
 * The api module is stubbed with `vi.spyOn` (the `points-tab.spec.tsx`
 * pattern). Assertions live here; `asset-point-bulk-edit-panel.test.tsx` is the
 * Vitest entry point and carries `@vitest-environment jsdom`.
 */

function renderPanel(ids: string[], onApplied = vi.fn()): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AssetPointBulkEditPanel ids={ids} onApplied={onApplied} onCancel={vi.fn()} />
    </QueryClientProvider>,
  );
}

/** Case 1 — an untouched panel offers nothing to apply, and says why. */
export function anUntouchedPanelCannotBeApplied(): void {
  renderPanel(["id-1", "id-2"]);

  expect(screen.getByRole("button", { name: "Apply to 2 rows" })).toBeDisabled();
  expect(screen.getByText(/nothing is set/i)).toBeInTheDocument();
  // Every input starts disabled beside its unticked box, so a value cannot be
  // typed into a field that will not be sent.
  expect(screen.getByLabelText("New scale multiplier")).toBeDisabled();
}

/** Case 2 — ticking one field sends exactly that field. */
export async function applyingSendsExactlyTheTickedField(): Promise<void> {
  const bulkUpdate = vi
    .spyOn(assetPointsApi, "bulkUpdateAdminAssetPoints")
    .mockResolvedValue({ items: [] });
  const onApplied = vi.fn();
  renderPanel(["id-1"], onApplied);

  await userEvent.click(screen.getByLabelText("Change scale multiplier"));
  await userEvent.type(screen.getByLabelText("New scale multiplier"), "0.1");

  const apply = screen.getByRole("button", { name: "Apply to 1 row" });
  expect(apply).toBeEnabled();
  await userEvent.click(apply);

  await waitFor(() => expect(bulkUpdate).toHaveBeenCalledTimes(1));
  expect(bulkUpdate).toHaveBeenCalledWith({ ids: ["id-1"], patch: { scaleMultiplier: 0.1 } });
  await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
}

/** Case 3 — a zero multiplier is caught here, in the API's own terms. */
export async function aZeroMultiplierIsRefusedBeforeItIsSent(): Promise<void> {
  const bulkUpdate = vi.spyOn(assetPointsApi, "bulkUpdateAdminAssetPoints");
  renderPanel(["id-1"]);

  await userEvent.click(screen.getByLabelText("Change scale multiplier"));
  await userEvent.type(screen.getByLabelText("New scale multiplier"), "0");

  expect(screen.getByRole("button", { name: "Apply to 1 row" })).toBeDisabled();
  expect(screen.getByText(/must not be 0/i)).toBeInTheDocument();
  expect(bulkUpdate).not.toHaveBeenCalled();
}

/**
 * Case 4 — an entry that is not a number is refused **as typed**.
 *
 * This is why the four numeric boxes are text with `inputMode="decimal"`: a
 * `type="number"` box reports `12e` as `""`, an empty ticked field is the
 * explicit clear, and the panel would have cleared the column on every selected
 * row while the box on screen still read `12e`.
 */
export async function anEntryThatIsNotANumberIsRefusedAsTyped(): Promise<void> {
  const bulkUpdate = vi.spyOn(assetPointsApi, "bulkUpdateAdminAssetPoints");
  renderPanel(["id-1"]);

  await userEvent.click(screen.getByLabelText("Change engineering maximum"));
  await userEvent.type(screen.getByLabelText("New engineering maximum"), "12e");

  expect(screen.getByLabelText("New engineering maximum")).toHaveValue("12e");
  expect(screen.getByRole("button", { name: "Apply to 1 row" })).toBeDisabled();
  expect(screen.getByText(/is not a number/i)).toBeInTheDocument();
  expect(bulkUpdate).not.toHaveBeenCalled();
}

/** Case 5 — over the shared cap the panel names the number rather than failing at the route. */
export async function aSelectionOverTheCapIsRefusedWithItsSize(): Promise<void> {
  const overTheCap = Array.from({ length: MAX_ASSET_POINT_BULK_IDS + 1 }, (_, i) => `id-${i}`);
  renderPanel(overTheCap);

  await userEvent.click(screen.getByLabelText("Change unit"));

  expect(screen.getByRole("button", { name: `Apply to ${overTheCap.length} rows` })).toBeDisabled();
  expect(screen.getByText(new RegExp(String(MAX_ASSET_POINT_BULK_IDS)))).toBeInTheDocument();
}
