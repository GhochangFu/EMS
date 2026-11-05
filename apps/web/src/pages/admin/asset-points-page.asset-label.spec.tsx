import { screen, within } from "@testing-library/react";
import { expect } from "vitest";
import type { AdminAssetPointDto } from "@bms/shared";

import { openAdd, openRowAction, renderPage, ROW, stubApi } from "./asset-points-page.wizards.spec";

/**
 * `F4.316` PR 5 / ADR 0111 — the asset-points page names the asset `<code> · <RTU>`, or
 * `<code> · <location>` when it has no RTU: in the Asset cell (whose `· where` part wraps and
 * is never truncated), on the wizards' "Asset:" line and in the status wizard's title. The
 * select checkbox's accessible name and the search haystack keep the bare code (decision 6).
 * Assertions live here; `asset-points-page.asset-label.test.tsx` is the Vitest entry point.
 */

const ON_RTU: AdminAssetPointDto = { ...ROW, assetRtuName: "Gateway one", assetLocationName: "Site A" };
const NO_RTU: AdminAssetPointDto = { ...ROW, assetRtuName: null, assetLocationName: "Site A" };

/** The Asset cell of the one row, once the routed list has re-read under the asset's site. */
async function assetCell(row: AdminAssetPointDto): Promise<HTMLElement> {
  stubApi([row]);
  renderPage();
  const tr = (await screen.findByLabelText("Select PMP-1 kw")).closest("tr");
  if (!tr) throw new Error("no row");
  const cell = within(tr).getByText("PMP-1").closest("td");
  if (!cell) throw new Error("no Asset cell");
  return cell;
}

/** An asset on an RTU: `PMP-1 · Gateway one`. */
export async function theAssetCellNamesTheRtu(): Promise<void> {
  expect((await assetCell(ON_RTU)).textContent).toBe("PMP-1 · Gateway one");
}

/** The twin: no RTU, so `PMP-1 · Site A`. */
export async function theAssetCellNamesTheLocationWithoutAnRtu(): Promise<void> {
  expect((await assetCell(NO_RTU)).textContent).toBe("PMP-1 · Site A");
}

/** The `· where` span wraps (`whitespace-normal`) and carries no `truncate`. */
export async function theWherePartWrapsAndIsNeverTruncated(): Promise<void> {
  const where = within(await assetCell(ON_RTU)).getByText(/Gateway one$/);
  expect([where.classList.contains("whitespace-normal"), where.classList.contains("truncate")]).toEqual([true, false]);
}

/** The Edit wizard's "Asset:" line names the edited row by its label. */
export async function theEditWizardNamesTheAssetByItsLabel(): Promise<void> {
  stubApi([ON_RTU]);
  renderPage();
  await openRowAction("Edit");
  expect(await screen.findByText("Asset: PMP-1 · Gateway one")).toBeTruthy();
}

/** The routed Add wizard's "Asset:" line names the asset by its summary's label (no RTU: the location). */
export async function theAddWizardNamesTheRoutedAssetByItsLabel(): Promise<void> {
  stubApi([NO_RTU]);
  renderPage();
  const dialog = await openAdd();
  expect(await within(dialog).findByText("Asset: PMP-1 · Site A")).toBeTruthy();
}

/** The Deactivate wizard's title names the point by the asset's label and its key. */
export async function theStatusWizardNamesTheAssetByItsLabel(): Promise<void> {
  stubApi([ON_RTU]);
  renderPage();
  await openRowAction("Deactivate");
  expect(await screen.findByRole("dialog", { name: "Deactivate PMP-1 · Gateway one kw" })).toBeTruthy();
}
