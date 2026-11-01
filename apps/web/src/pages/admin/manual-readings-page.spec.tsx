import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
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
import { defaultLocalDateTime } from "../../lib/manual-reading-form";
import type { AuthUser } from "../../stores/auth-store";
import { useWizardStore } from "../../stores/wizard-store";
import { ManualReadingsPage } from "./manual-readings-page";
import * as copilotApi from "../../api/copilot";

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
        trendDefault: false,
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
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
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
  // `F4.283`: the form is the `telemetryReading.create` wizard — Next to Review, then Submit.
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(await screen.findByRole("button", { name: "Submit" }));
  // By pattern, so a raw read is FOUND and fails on its text rather than timing
  // out: the element holding the sentence must hold nothing else.
  const banner = await screen.findByText(new RegExp(SENTENCE));
  expect(submit).toHaveBeenCalledTimes(1);
  expect(banner.textContent).not.toContain('{"');
  expect(banner.textContent).toBe(SENTENCE);
}

/**
 * Control — an incomplete form builds no row, so the wizard's Next is disabled, each field names
 * what it needs, and nothing is sent. `F4.283` review: the per-field sentence is back — the
 * shell's `rows` refusal alone named no field. Mutation: render no field error → red.
 */
export async function anInvalidFormShowsTheFixSentenceWithoutACall(): Promise<void> {
  const { submit } = stubApi();
  renderPage();
  await screen.findByText("F4204 · Spec Org");
  expect([
    screen.getByText("Asset is required.") instanceof HTMLElement,
    (screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled,
    submit.mock.calls.length,
  ]).toEqual([true, true, 0]);
}

const FILLED_AT = "2026-10-20T08:30:00.000Z";

/** A copilot fill of the Readings step with the asset, the point key, the value and the time. */
function fillTheReadingsStep(): void {
  act(() =>
    useWizardStore.getState().receiveFill(
      {
        catalogId: "telemetryReading.create",
        params: {},
        stepId: "rows",
        values: { rows: [{ assetId: ASSET_ID, pointKey: POINT_KEY, value: 7, time: FILLED_AT }] },
      },
      null,
    ),
  );
}

/** `F4.283` review: a fill's time lands in the Timestamp field. Mutation: drop the time from `onChange` → red. */
export async function aFillSetsTheTimestamp(): Promise<void> {
  stubApi();
  renderPage();
  await screen.findByText("F4204 · Spec Org");
  fillTheReadingsStep();
  expect((screen.getByLabelText("Timestamp") as HTMLInputElement).value).toBe(defaultLocalDateTime(new Date(FILLED_AT)));
}

/** `F4.283` review: a fill's asset reaches the sent row. Mutation: drop the asset from `onChange` → red. */
export async function aFillSendsTheFilledAsset(): Promise<void> {
  const { submit } = stubApi();
  submit.mockResolvedValue({
    result: { written: 1, skipped: 0, assetPointsCreated: 0, firstTime: null, lastTime: null, batchId: "f4283000-0000-4000-8000-000000000003" },
    rejected: [],
  } as never);
  renderPage();
  await screen.findByText("F4204 · Spec Org");
  fillTheReadingsStep();
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(await screen.findByRole("button", { name: "Submit" }));
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  expect(submit.mock.calls[0]?.[0]?.[0]?.assetId).toBe(ASSET_ID);
}

/** `F4.283`: the wizard submits the same request as the old form — the one row and the policy. */
export async function theWizardSubmitsTheSameRequest(): Promise<void> {
  const { submit } = stubApi();
  submit.mockResolvedValue({
    result: { written: 1, skipped: 0, assetPointsCreated: 0, firstTime: null, lastTime: null, batchId: "f4283000-0000-4000-8000-000000000001" },
    rejected: [],
  } as never);
  renderPage();
  await fillAValidReading();
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(await screen.findByRole("button", { name: "Submit" }));
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  const [rows, policy] = submit.mock.calls[0] ?? [];
  expect([rows?.length, rows?.[0]?.assetId, rows?.[0]?.pointKey, rows?.[0]?.value, policy]).toEqual([1, ASSET_ID, POINT_KEY, 42, "reject"]);
}
