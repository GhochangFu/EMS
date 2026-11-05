import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect } from "vitest";

import { MEMBERS, renderPage, stubApi } from "./asset-groups-page.spec";

/**
 * `F4.316` PR 5 / ADR 0111 — the members table names each asset `<code> · <RTU>`, or
 * `<code> · <location>` when it has no RTU; the `· where` part wraps and is never truncated.
 * Assertions live here; `asset-groups-page.asset-label.test.tsx` is the Vitest entry point.
 */

const LABELLED = {
  ...MEMBERS,
  items: MEMBERS.items.map((member, index) =>
    index === 0
      ? { ...member, assetRtuName: "RTU 1", assetLocationName: "Plant A" }
      : { ...member, assetRtuName: null, assetLocationName: "Plant A" },
  ),
};

/** The member row of `assetName`, once the group is open. */
async function memberRow(assetName: string): Promise<HTMLElement> {
  stubApi({ fetchAdminAssetGroupMembers: () => Promise.resolve(LABELLED) });
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: /Electrical train/ }));
  const name = await screen.findByText(assetName);
  const row = name.closest("tr");
  if (!row) throw new Error(`no row for ${assetName}`);
  return row;
}

/** An asset on an RTU: the code cell reads `TRF-03 · RTU 1`. */
export async function aMemberOnAnRtuIsNamedByIt(): Promise<void> {
  const row = await memberRow("Transformer 3");
  expect(within(row).getByText("TRF-03").parentElement?.textContent).toBe("TRF-03 · RTU 1");
}

/** The twin: no RTU, so `TRF-01 · Plant A`. */
export async function aMemberWithoutAnRtuIsNamedByItsLocation(): Promise<void> {
  const row = await memberRow("Transformer 1");
  expect(within(row).getByText("TRF-01").parentElement?.textContent).toBe("TRF-01 · Plant A");
}

/** The `· where` span wraps (`whitespace-normal`) and carries no `truncate`. */
export async function theWherePartWrapsAndIsNeverTruncated(): Promise<void> {
  const row = await memberRow("Transformer 3");
  const where = within(row).getByText(/RTU 1$/);
  expect([where.classList.contains("whitespace-normal"), where.classList.contains("truncate")]).toEqual([true, false]);
}
