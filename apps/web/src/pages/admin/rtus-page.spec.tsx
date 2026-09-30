import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { AdminRtuDto } from "@bms/shared";

import * as locationsApi from "../../api/admin/locations";
import * as organizationsApi from "../../api/admin/organizations";
import * as rtusApi from "../../api/admin/rtus";
import * as systemStatusApi from "../../api/system-status";
import { OPERATIONAL } from "../../components/system-status-indicator.spec";
import { ApiError } from "../../lib/api-error";
import type { AuthUser } from "../../stores/auth-store";
import { RtusAdminPage } from "./rtus-page";

/**
 * `F4.182` — the RTUs admin screen sets `rtus.rtu_code`, the device key the
 * ingest host matches each MQTT payload's `dev_id` against
 * (`apps/ingest/src/host/bindings.ts`, ADR 0016 §3). Before this row no screen
 * wrote it, so an RTU made from the UI or the onboarding workbook never
 * ingested (v1 user guide item PO-1). Assertions live here;
 * `rtus-page.test.tsx` is the Vitest entry point and carries the jsdom
 * docblock (ADR 0042 decision 2).
 *
 * Every read the page and its chrome issue is stubbed: `fetchSystemStatus`
 * (AppShell, `F4.160`), the hierarchy bar's organization and location reads,
 * and the RTU list. An unstubbed read reaches a local API on `:4000`.
 */

const admin: AuthUser = {
  id: "u1",
  email: "admin@bms.local",
  displayName: "Admin",
  role: "admin",
} as unknown as AuthUser;

const LOCATION_ID = "11111111-1111-4111-8111-111111111111";

function rtu(overrides: Partial<AdminRtuDto>): AdminRtuDto {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    locationId: LOCATION_ID,
    locationName: "Spec site",
    organizationCode: "SPEC",
    code: "F4182-A",
    displayName: "Spec gateway A",
    sourceType: "mqtt",
    domain: null,
    externalRtuId: null,
    rtuCode: null,
    mqttTopic: null,
    stationCode: null,
    stationName: null,
    ingestEnabled: true,
    active: true,
    meta: null,
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
}

/** A gateway that already routes, and one that has no device key yet — the NULL the seed leaves on 44 RTUs. */
const ROUTED = rtu({ rtuCode: "861736076081915" });
const UNROUTED = rtu({
  id: "33333333-3333-4333-8333-333333333333",
  code: "F4182-B",
  displayName: "Spec gateway B",
  rtuCode: null,
});

function stubAll(): void {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(organizationsApi, "fetchAdminOrganizations").mockResolvedValue({ items: [] } as never);
  vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue({
    items: [{ id: LOCATION_ID, name: "Spec site" }],
  } as never);
  vi.spyOn(locationsApi, "fetchAdminLocationSummary").mockResolvedValue({} as never);
  vi.spyOn(rtusApi, "fetchAdminRtus").mockResolvedValue({ items: [ROUTED, UNROUTED] } as never);
  vi.spyOn(rtusApi, "createAdminRtu").mockResolvedValue(ROUTED);
  vi.spyOn(rtusApi, "updateAdminRtu").mockResolvedValue(ROUTED);
}

function renderPage(): void {
  stubAll();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/rtus"]}>
        <RtusAdminPage user={admin} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The `<tr>` that carries `code` in its Code cell. */
async function rowOf(code: string): Promise<HTMLElement> {
  const cell = await screen.findByText(code);
  const row = cell.closest("tr");
  if (!row) throw new Error(`no row for ${code}`);
  return row;
}

const DEVICE_ID_LABEL = "Device ID (dev_id)";

/** The single argument of the only call to `fn`. */
function onlyBody(fn: unknown): Record<string, unknown> {
  const mock = vi.mocked(fn as (...args: unknown[]) => unknown);
  expect(mock).toHaveBeenCalledTimes(1);
  const args = mock.mock.calls[0] ?? [];
  return args[args.length - 1] as Record<string, unknown>;
}

async function openEdit(code: string): Promise<void> {
  const row = await rowOf(code);
  await userEvent.click(within(row).getByRole("button", { name: "Edit" }));
}

/** R1 — the list shows each RTU's device ID, and a dash where it has none. */
export async function listShowsTheDeviceIdAndADashWhenUnset(): Promise<void> {
  renderPage();
  const header = await screen.findByRole("columnheader", { name: "Device ID" });
  expect(header).toBeInTheDocument();
  const routed = await rowOf(ROUTED.code);
  expect(within(routed).getByText("861736076081915")).toBeInTheDocument();
  const unrouted = await rowOf(UNROUTED.code);
  expect(within(unrouted).getByText("—")).toBeInTheDocument();
}

/** R2 — create sends the typed device ID, trimmed: a pasted space never matches a `dev_id`. */
export async function createSendsTheTrimmedDeviceId(): Promise<void> {
  const user = userEvent.setup();
  renderPage();
  await rowOf(ROUTED.code);
  await user.click(screen.getByRole("button", { name: "Add RTU" }));
  await user.selectOptions(await screen.findByLabelText("Location"), LOCATION_ID);
  await user.type(screen.getByLabelText("Code"), "F4182-NEW");
  await user.type(screen.getByLabelText("Display name"), "Spec new");
  await user.type(screen.getByLabelText(DEVICE_ID_LABEL), "  861736076128260 ");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(rtusApi.createAdminRtu).toHaveBeenCalledTimes(1));
  const body = onlyBody(rtusApi.createAdminRtu);
  expect(body.rtuCode).toBe("861736076128260");
  expect(body.code).toBe("F4182-NEW");
}

/** R3 — create with the field left blank sends no `rtuCode` key, so the column stays NULL, not `''` (`F4.143`). */
export async function createWithABlankDeviceIdOmitsTheKey(): Promise<void> {
  const user = userEvent.setup();
  renderPage();
  await rowOf(ROUTED.code);
  await user.click(screen.getByRole("button", { name: "Add RTU" }));
  await user.selectOptions(await screen.findByLabelText("Location"), LOCATION_ID);
  await user.type(screen.getByLabelText("Code"), "F4182-NEW");
  await user.type(screen.getByLabelText("Display name"), "Spec new");
  await user.type(screen.getByLabelText(DEVICE_ID_LABEL), "   ");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(rtusApi.createAdminRtu).toHaveBeenCalledTimes(1));
  const body = onlyBody(rtusApi.createAdminRtu);
  expect(body.code).toBe("F4182-NEW");
  expect("rtuCode" in body).toBe(false);
}

/** R4 — an edit that leaves the device ID alone sends no `rtuCode` key, so a NULL is never flipped to `''`. */
export async function editWithTheDeviceIdUntouchedOmitsTheKey(): Promise<void> {
  const user = userEvent.setup();
  renderPage();
  await openEdit(UNROUTED.code);
  const field = screen.getByLabelText(DEVICE_ID_LABEL);
  expect(field).toHaveValue("");
  const name = screen.getByLabelText("Display name");
  await user.clear(name);
  await user.type(name, "Renamed B");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(rtusApi.updateAdminRtu).toHaveBeenCalledTimes(1));
  const body = onlyBody(rtusApi.updateAdminRtu);
  expect(body.displayName).toBe("Renamed B");
  expect("rtuCode" in body).toBe(false);
}

/** R5 — the edit form shows the stored device ID and sends a changed one, trimmed, for that RTU. */
export async function editSendsAChangedDeviceId(): Promise<void> {
  const user = userEvent.setup();
  renderPage();
  await openEdit(ROUTED.code);
  const field = screen.getByLabelText(DEVICE_ID_LABEL);
  expect(field).toHaveValue("861736076081915");
  await user.clear(field);
  await user.type(field, "861736076128245 ");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(rtusApi.updateAdminRtu).toHaveBeenCalledTimes(1));
  expect(vi.mocked(rtusApi.updateAdminRtu).mock.calls[0]?.[0]).toBe(ROUTED.id);
  expect(onlyBody(rtusApi.updateAdminRtu).rtuCode).toBe("861736076128245");
}

/** R6 — clearing a stored device ID sends `''`, the only value that clears the column (`rtus.schema.ts`, `F4.60`). */
export async function editClearingTheDeviceIdSendsEmpty(): Promise<void> {
  const user = userEvent.setup();
  renderPage();
  await openEdit(ROUTED.code);
  await user.clear(screen.getByLabelText(DEVICE_ID_LABEL));
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(rtusApi.updateAdminRtu).toHaveBeenCalledTimes(1));
  expect(onlyBody(rtusApi.updateAdminRtu).rtuCode).toBe("");
}

/** The owner-ruled `F4.60` refusal body, as the API sends it. */
const TAKEN_MESSAGE =
  "That rtuCode is already taken. It is the device key the ingest host routes by, " +
  "so two RTUs cannot share one. Choose a different rtuCode.";

/** R7 — a taken device ID shows the API's sentence in the dialog, not the raw JSON envelope. */
export async function aTakenDeviceIdShowsTheApiSentence(): Promise<void> {
  const user = userEvent.setup();
  renderPage();
  vi.mocked(rtusApi.updateAdminRtu).mockRejectedValue(
    new ApiError(JSON.stringify({ message: TAKEN_MESSAGE, error: "Conflict", statusCode: 409 }), 409),
  );
  await openEdit(UNROUTED.code);
  await user.type(screen.getByLabelText(DEVICE_ID_LABEL), "861736076081915");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText(TAKEN_MESSAGE)).toBeInTheDocument();
  expect(screen.queryByText(/"statusCode"/)).toBeNull();
  // The dialog stays open, so the admin can correct the value.
  expect(screen.getByRole("heading", { name: "Edit RTU" })).toBeInTheDocument();
}
