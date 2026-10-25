import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import * as api from "../../api/admin/telemetry-import";
import * as assetsApi from "../../api/assets";
import * as systemStatusApi from "../../api/system-status";
import { describeImportUploadError } from "../../lib/telemetry-import-preview";
import type { AuthUser } from "../../stores/auth-store";
import { TelemetryImportPage } from "./telemetry-import-page";
import * as copilotApi from "../../api/copilot";

/**
 * `F4.204` — the Import Telemetry page reads a refused upload through
 * `apiErrorMessage`. Assertions live here; `telemetry-import-page.test.tsx` is
 * the Vitest entry point and carries the `@vitest-environment jsdom` docblock.
 *
 * **Route-only, not a defect.** The two upload calls throw a sentence already —
 * `describeImportUploadError` builds it from the status and body — so this
 * case proves only that routing it through `apiErrorMessage` leaves it as it
 * was: a message that does not start with `{` passes through unchanged.
 */

const admin: AuthUser = {
  id: "u1",
  email: "admin@bms.local",
  displayName: "Admin",
  role: "admin",
} as unknown as AuthUser;

function stubApi() {
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("no fetch expected"))));
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockRejectedValue(new Error("not under test"));
  vi.spyOn(assetsApi, "fetchAssets").mockResolvedValue([] as never);
  return {
    preview: vi.spyOn(api, "previewTelemetryImport").mockRejectedValue(new Error("not under test")),
    commit: vi.spyOn(api, "commitTelemetryImport").mockRejectedValue(new Error("not under test")),
  };
}

function renderPage(): HTMLElement {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/admin/telemetry-import"]}>
        <TelemetryImportPage user={admin} />
      </MemoryRouter>
    </QueryClientProvider>,
  ).container;
}

/** F4.204 — a refused preview shows the describer's sentence unchanged. */
export async function aRefusedPreviewShowsTheDescribersSentence(): Promise<void> {
  const { preview } = stubApi();
  // What `previewTelemetryImport` throws on a 413 from the proxy.
  const sentence = describeImportUploadError(413, "");
  preview.mockRejectedValue(new Error(sentence));
  const container = renderPage();
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("no file input");
  await userEvent.upload(input, new File(["asset_code,point_key,value,time\n"], "readings.csv", { type: "text/csv" }));
  await userEvent.click(screen.getByRole("button", { name: "Preview" }));
  const banner = await screen.findByText(sentence);
  expect(preview).toHaveBeenCalledTimes(1);
  expect(banner.textContent).not.toContain('{"');
}

/**
 * `F4.283` (ADR 0099 Amendment 8): the commit is the `telemetry.import` wizard, and it sends the
 * same request as the old Commit button — the chosen file and the two options.
 */
export async function theWizardCommitsTheChosenFileAndOptions(): Promise<void> {
  const { file, commit } = await pickAndPreview(1);
  await userEvent.selectOptions(screen.getByLabelText("Source kind"), "manual");
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(await screen.findByRole("button", { name: "Submit" }));
  await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
  expect(commit.mock.calls[0]).toEqual([file, { sourceKind: "manual", conflictPolicy: "reject" }]);
}

const COMMITTED = {
  written: 1,
  skipped: 0,
  assetPointsCreated: 0,
  firstTime: null,
  lastTime: null,
  batchId: "f4283000-0000-4000-8000-000000000002",
  rejected: [],
};

/** Picks `readings.csv` and, when `accepted` is a number, previews it with that accepted count. */
async function pickAndPreview(accepted: number | null): Promise<{ file: File; commit: ReturnType<typeof stubApi>["commit"] }> {
  const { preview, commit } = stubApi();
  preview.mockResolvedValue({
    totalRows: 1,
    acceptedCount: accepted ?? 0,
    rejectedCount: accepted === 0 ? 1 : 0,
    rejected: accepted === 0 ? [{ rowNumber: 2, field: "value", reason: "must be a number" }] : [],
  } as never);
  commit.mockResolvedValue(COMMITTED as never);
  const container = renderPage();
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("no file input");
  const file = new File(["asset_code,point_key,value,time\n"], "readings.csv", { type: "text/csv" });
  await userEvent.upload(input, file);
  if (accepted !== null) {
    await userEvent.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByText("2. Preview");
  }
  return { file, commit };
}

/** `F4.283` review: a picked file with no preview cannot reach the commit. Mutation: drop `nextDisabled` → red. */
export async function nextIsDisabledWithoutAPreview(): Promise<void> {
  await pickAndPreview(null);
  expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
}

/** `F4.283` review: a preview that accepted no row cannot reach the commit. */
export async function nextIsDisabledWhenThePreviewAcceptsNoRow(): Promise<void> {
  await pickAndPreview(0);
  expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
}

/** `F4.283` review: a second Submit after a commit sends nothing. Mutation: drop the `onSubmit` guard → red. */
export async function aSecondSubmitAfterACommitSendsNothing(): Promise<void> {
  const { commit } = await pickAndPreview(1);
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(await screen.findByRole("button", { name: "Submit" }));
  await screen.findByText("This file is committed. Start over to import another.");
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
  expect(commit).toHaveBeenCalledTimes(1);
}

/** The file is never a wizard value: the Review card names the options only. */
export async function theFileIsNotAWizardValue(): Promise<void> {
  await pickAndPreview(1);
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  const review = await screen.findByRole("button", { name: "Submit" });
  expect(review.closest("section")?.textContent ?? "").not.toContain("readings.csv");
}
