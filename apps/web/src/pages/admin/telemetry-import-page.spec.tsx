import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import * as api from "../../api/admin/telemetry-import";
import * as assetsApi from "../../api/assets";
import * as systemStatusApi from "../../api/system-status";
import { describeImportUploadError } from "../../lib/telemetry-import-preview";
import type { AuthUser } from "../../stores/auth-store";
import { TelemetryImportPage } from "./telemetry-import-page";

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
