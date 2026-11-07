import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { expect, vi, type Mock } from "vitest";
import type { DashboardTemplateDto, SiteLayoutBulkReplaceResultDto, SiteLayoutReplacePreviewDto } from "@bms/shared";

import * as locationsApi from "../../api/admin/locations";
import * as replaceApi from "../../api/admin/site-layout-replace";
import { REPLACED_BODY } from "../../api/admin/site-layout-replace.spec";
import { LOC_1, LOC_2, publishedSiteTemplate } from "../../pages/admin/dashboard-template-detail-page.spec";
import { resetWizardStore } from "../../stores/wizard-store";
import { ApplyToSitesDialog } from "./apply-to-sites-dialog";

/**
 * `F4.320` PR 2 (ADR 0087 Amendment 4 decisions 5, 8 and 9) — the apply-to-sites dialog's
 * **Replace existing copies**: the bulk preview lists each site with the copy it holds, its edit
 * flag and its outcome; Submit calls the bulk route once; the answer lists the replaced sites and
 * every skip with its plain reason; a pending Submit is disabled and announced. The two clients
 * are spies (wire shape: `api/admin/site-layout-replace.spec.ts`); `fetch` itself rejects.
 */

const LOC_3 = "33333333-3333-4333-8333-333333333333";
const held = (version: number, code = "pump-station-standard") => ({
  dashboardId: REPLACED_BODY.previousDashboardId,
  templateId: REPLACED_BODY.previousTemplateId,
  templateCode: code,
  version,
});

const PREVIEW: SiteLayoutReplacePreviewDto = {
  templateId: REPLACED_BODY.templateId,
  templateCode: "pump-station-standard",
  version: 2,
  sites: [
    {
      locationId: LOC_1,
      locationName: "Bilsi",
      held: held(1),
      outcome: "replace",
      edits: { count: 3, lastEditedAt: "2026-11-06T10:00:00.000Z", lastEditedBy: "phe-admin@bms.local" },
    },
    { locationId: LOC_2, locationName: "Lotapata", held: held(2), outcome: "same_version", edits: { count: 0, lastEditedAt: null } },
    { locationId: LOC_3, locationName: "Moranodir", held: null, outcome: "no_copy", edits: null },
  ],
};

const RESULT: SiteLayoutBulkReplaceResultDto = {
  replaced: [{ ...REPLACED_BODY, locationId: LOC_1 }],
  skipped: [
    { locationId: LOC_2, reason: "same_version" },
    { locationId: LOC_3, reason: "no_copy" },
  ],
};

function renderDialog(
  replaceImpl?: () => Promise<SiteLayoutBulkReplaceResultDto>,
  previewImpl: () => Promise<SiteLayoutReplacePreviewDto> = () => Promise.resolve(PREVIEW),
): { bulk: Mock; onClose: Mock } {
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("a spec reached the network"))));
  vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue({ items: [] } as never);
  vi.spyOn(replaceApi, "fetchSiteLayoutsReplacePreview").mockImplementation(previewImpl);
  const bulk = vi.spyOn(replaceApi, "replaceSiteLayouts");
  bulk.mockImplementation(replaceImpl ?? (() => Promise.resolve(RESULT)));
  const onClose = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ApplyToSitesDialog template={publishedSiteTemplate() as unknown as DashboardTemplateDto} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { bulk: bulk as unknown as Mock, onClose };
}

export function cleanupBulkReplace(): void {
  cleanup();
  resetWizardStore();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
}

/** Opens Replace existing copies and returns the confirm's region once the preview rows are in. */
async function openReplace(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name: "Replace existing copies" }));
  // The loading state is its own tree (no Submit), so the region is read once the rows are in.
  await screen.findByText("Bilsi");
  return screen.getByRole("region", { name: "What Replace changes" });
}

/** D1 — the preview lists each site: the copy held, its edit flag and what will happen; nothing is sent yet. */
export async function thePreviewListsEachSite(): Promise<void> {
  const { bulk } = renderDialog();
  const region = await openReplace();
  const rows = within(region)
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent));
  expect(rows).toEqual([
    [
      "Bilsi",
      "pump-station-standard v1",
      "Edited 3 times since the copy, last on 2026-11-06 by phe-admin@bms.local",
      "Will be deleted and made again",
    ],
    ["Lotapata", "pump-station-standard v2", "No recorded edit since the copy", "Skipped — the copy already holds this version"],
    ["Moranodir", "No template copy", "—", "Skipped — the site holds no site-template copy"],
  ]);
  expect(region.textContent).toContain("Every builder edit on the copy is lost");
  expect(bulk).not.toHaveBeenCalled();
}

/** D2 — Submit calls the bulk route once for the template; the answer lists the replaced site and each skip's reason. */
export async function submitCallsTheBulkRouteAndListsTheSkips(): Promise<void> {
  const { bulk } = renderDialog();
  await openReplace();
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));

  expect(await screen.findByText("1 site replaced, 2 skipped.")).toBeInTheDocument();
  expect(bulk.mock.calls).toEqual([[publishedSiteTemplate().id]]);
  const rows = screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent));
  expect(rows).toEqual([
    ["Bilsi", "Replaced v1 with v2 — Made — 0 tabs"],
    ["Lotapata", "Skipped — The site's copy already holds this version"],
    ["Moranodir", "Skipped — The site holds no site-template copy to replace"],
  ]);
}

/**
 * D4 — no confirm without the preview: while it loads, and after it fails, there is no Submit,
 * only Cancel, and the bulk route is never called. The positive twin is D2 (Submit once loaded).
 * Mutation, applied once and seen red: drop the `!previewQ.isSuccess` early return → Submit renders.
 */
export async function submitIsAbsentUntilThePreviewIsRead(): Promise<void> {
  const { bulk, onClose } = renderDialog(undefined, () => new Promise(() => undefined));
  fireEvent.click(screen.getByRole("button", { name: "Replace existing copies" }));
  expect(await screen.findByText("Reading the sites…")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Submit" }), "no Submit while the preview loads").toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(bulk).not.toHaveBeenCalled();
  cleanupBulkReplace();

  const failed = renderDialog(undefined, () => Promise.reject(new Error("preview failed")));
  fireEvent.click(screen.getByRole("button", { name: "Replace existing copies" }));
  expect((await screen.findByRole("alert")).textContent).toContain("The sites could not be read");
  expect(screen.queryByRole("button", { name: "Submit" }), "no Submit after the preview failed").toBeNull();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  expect(failed.bulk).not.toHaveBeenCalled();
}

/** D3 — while the bulk Replace pends, Submit is disabled, renamed and `aria-busy`. */
export async function aPendingBulkSubmitIsDisabledAndBusy(): Promise<void> {
  renderDialog(() => new Promise(() => undefined));
  await openReplace();
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));

  const pending = await screen.findByRole("button", { name: "Submitting…" });
  expect([pending.hasAttribute("disabled"), pending.getAttribute("aria-busy")]).toEqual([true, "true"]);
}
