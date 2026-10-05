import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import * as assetsAdminApi from "../../api/admin/assets";
import * as locationsApi from "../../api/admin/locations";
import * as api from "../../api/admin/manual-readings";
import * as organizationsApi from "../../api/admin/organizations";
import * as pointKeysApi from "../../api/admin/point-keys";
import * as rtusApi from "../../api/admin/rtus";
import * as assetsApi from "../../api/assets";
import * as systemStatusApi from "../../api/system-status";
import { ApiError } from "../../lib/api-error";
import type { AuthUser } from "../../stores/auth-store";
import { ManualReadingsPage } from "./manual-readings-page";

/**
 * `F4.204` — the Manual Entry page reads a refused submit through
 * `apiErrorMessage`. Assertions live here; `manual-readings-page.test.tsx` is
 * the Vitest entry point and carries the `@vitest-environment jsdom` docblock.
 *
 * Every call the page (and `MasterDataLayout`'s `AppShell`) makes is stubbed,
 * and `fetch` itself rejects, so a call this file forgot fails loudly rather
 * than reaching the real API on :4000.
 */

const admin: AuthUser = {
  id: "u1",
  email: "admin@bms.local",
  displayName: "Admin",
  role: "admin",
} as unknown as AuthUser;

const ORG_ID = "f4204000-0000-4000-8000-000000000001";
const LOCATION_ID = "f4204000-0000-4000-8000-000000000002";
const ASSET_ID = "f4204000-0000-4000-8000-000000000003";
const POINT_KEY = "f4204_spec_kw";

const SENTENCE = "A reading already exists at that timestamp";

function stubApi() {
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("no fetch expected"))));
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockRejectedValue(new Error("not under test"));
  vi.spyOn(assetsApi, "fetchAssets").mockResolvedValue([] as never);
  vi.spyOn(organizationsApi, "fetchAdminOrganizations").mockResolvedValue({
    items: [{ id: ORG_ID, code: "F4204", name: "Spec Org", active: true }],
  } as never);
  vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue({
    items: [{ id: LOCATION_ID, name: "Spec Plant", organizationId: ORG_ID, active: true }],
  } as never);
  vi.spyOn(rtusApi, "fetchAdminRtus").mockResolvedValue({ items: [] } as never);
  vi.spyOn(assetsAdminApi, "fetchAdminAssets").mockResolvedValue({
    items: [{ id: ASSET_ID, code: "SPEC-01", name: "Spec Meter", locationId: LOCATION_ID, active: true }],
  } as never);
  vi.spyOn(pointKeysApi, "fetchAdminPointKeys").mockResolvedValue({
    items: [
      {
        id: "f4204000-0000-4000-8000-000000000004",
        code: POINT_KEY,
        name: "Spec power",
        domain: "electrical",
        unit: "kW",
        description: null,
        active: true,
        createdAt: new Date(0).toISOString(),
        headlineRank: null,
      },
    ],
  });
  return {
    submit: vi.spyOn(api, "submitManualReadings").mockResolvedValue({
      accepted: 1,
      rejected: [],
    } as never),
  };
}

function renderPage(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/admin/manual-readings"]}>
        <ManualReadingsPage user={admin} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Picks org → location → asset → point key and types a value, so the form validates. */
async function fillAValidReading(): Promise<void> {
  await screen.findByText("F4204 · Spec Org");
  await userEvent.selectOptions(screen.getByDisplayValue("Select organization"), ORG_ID);
  await screen.findByText("Spec Plant");
  await userEvent.selectOptions(screen.getByDisplayValue("Select location"), LOCATION_ID);
  await screen.findByText("SPEC-01 · Spec Meter");
  await userEvent.selectOptions(screen.getByDisplayValue("Select asset"), ASSET_ID);
  await screen.findByText(`${POINT_KEY} · Spec power`);
  await userEvent.selectOptions(screen.getByDisplayValue("Select point key"), POINT_KEY);
  await userEvent.type(screen.getByLabelText("Value"), "42");
}

/** F4.204 — a refused submit shows the sentence, not the envelope. */
export async function aRefusedSubmitShowsTheSentence(): Promise<void> {
  const { submit } = stubApi();
  submit.mockRejectedValue(
    new ApiError(`{"statusCode":409,"message":"${SENTENCE}","error":"Conflict"}`, 409),
  );
  renderPage();
  await fillAValidReading();
  await userEvent.click(screen.getByRole("button", { name: "Submit reading" }));
  // By pattern, so a raw read is FOUND and fails on its text rather than timing
  // out: the element holding the sentence must hold nothing else.
  const banner = await screen.findByText(new RegExp(SENTENCE));
  expect(submit).toHaveBeenCalledTimes(1);
  expect(banner.textContent).not.toContain('{"');
  expect(banner.textContent).toBe(SENTENCE);
}

/**
 * Control — the client-side refusal still shows its own sentence, with no
 * call: it is a plain `Error`, and `apiErrorMessage` passes a non-`{` message
 * through unchanged.
 */
export async function anInvalidFormShowsTheFixSentenceWithoutACall(): Promise<void> {
  const { submit } = stubApi();
  renderPage();
  await screen.findByText("F4204 · Spec Org");
  await userEvent.click(screen.getByRole("button", { name: "Submit reading" }));
  expect(await screen.findByText("Fix the highlighted fields before submitting.")).toBeInTheDocument();
  expect(screen.getByText("Asset is required.")).toBeInTheDocument();
  expect(submit).not.toHaveBeenCalled();
}
