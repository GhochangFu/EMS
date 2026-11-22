import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import * as organizationsApi from "../../api/admin/organizations";
import * as copilotApi from "../../api/copilot";
import * as systemStatusApi from "../../api/system-status";
import {
  ORG_ID,
  profile,
  register,
  stockProfile,
  stubWire,
  type WireCall,
  type WireReply,
} from "../../components/admin/device-profile-test-fixtures";
import { OPERATIONAL } from "../../components/system-status-indicator.spec";
import type { AuthUser } from "../../stores/auth-store";
import { DeviceProfilesAdminPage } from "./device-profiles-page";

/**
 * `F1.2` (ADR 0141 decisions 13–14, plan T6.1) — the Device Profiles admin
 * screen, rendered. Assertions live here; `device-profiles-page.test.tsx` is
 * the Vitest entry point with the jsdom docblock (ADR 0042).
 *
 * The chrome's reads (`MasterDataLayout`) and the organizations list are
 * stubbed with `vi.spyOn`; every device-profile request is read on the wire
 * (`stubWire`), so a route, a method or a body is what the client sent.
 */

const admin = { id: "u1", email: "admin@bms.local", displayName: "Admin", role: "admin" } as unknown as AuthUser;
const locationAdmin = {
  id: "u3",
  email: "wc-admin@bms.local",
  displayName: "WC Admin",
  role: "location_admin",
} as unknown as AuthUser;

const METER_V1 = "aaaaaaaa-0000-4000-8000-000000000001";
const METER_V2 = "aaaaaaaa-0000-4000-8000-000000000002";
const METER_V3 = "aaaaaaaa-0000-4000-8000-000000000003";
const ORG_B = "99999999-9999-4999-8999-999999999999";
const PUMP_V1 = "bbbbbbbb-0000-4000-8000-000000000001";

/**
 * Two codes, four rows. `spec_meter` is listed v1, v3, v2: the newest is
 * neither the first nor the last row, so the page's "newest" is computed.
 */
const LIST = [
  profile({ id: METER_V1, code: "spec_meter", version: 1, vendor: "Old Vendor", model: "OLD-1" }),
  profile({
    id: METER_V3,
    code: "spec_meter",
    version: 3,
    vendor: "Meter Vendor",
    model: "MV-2",
    registers: [register({ sourceKey: "kwh_total", address: 0 }), register({ sourceKey: "kw_total", address: 2 })],
  }),
  profile({ id: METER_V2, code: "spec_meter", version: 2, vendor: "Mid Vendor", model: "MID-2" }),
  profile({ id: PUMP_V1, code: "spec_pump", version: 1, vendor: "Pump Vendor", model: "PV-1", verified: true }),
];

const STOCK = [
  stockProfile({ code: "stock_alpha", vendor: "Alpha Co", model: "AL-1" }),
  stockProfile({ code: "stock_beta", vendor: "Beta Co", model: "BE-2", verified: false }),
  // A code the organization already holds (at v1): its import is a new version, so it asks first.
  stockProfile({ code: "spec_pump", vendor: "Pump Vendor", model: "PV-1" }),
];

const LIST_PATH = `/admin/device-profiles?organizationId=${ORG_ID}`;

function stubAll(extra: (call: WireCall) => WireReply | undefined = () => undefined): WireCall[] {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  vi.spyOn(organizationsApi, "fetchAdminOrganizations").mockResolvedValue({
    items: [
      { id: ORG_ID, code: "F12ORG", name: "Spec organization" },
      { id: ORG_B, code: "F12ORGB", name: "Second organization" },
    ],
  } as never);
  return stubWire((call) => {
    const answered = extra(call);
    if (answered) return answered;
    if (call.method === "GET" && call.path === LIST_PATH) return { status: 200, body: LIST };
    if (call.method === "GET" && call.path === `/admin/device-profiles?organizationId=${ORG_B}`) {
      return { status: 200, body: [] };
    }
    if (call.method === "GET" && call.path === "/admin/device-profiles/stock") return { status: 200, body: STOCK };
    return undefined;
  });
}

function renderPage(as: AuthUser): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/device-profiles"]}>
        <DeviceProfilesAdminPage user={as} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function profileRow(code: string): Promise<HTMLElement> {
  await screen.findByRole("cell", { name: code });
  const found = document.querySelector<HTMLElement>(`[data-profile-code="${code}"]`);
  if (!found) throw new Error(`no row for ${code}`);
  return found;
}

function writes(calls: readonly WireCall[]): WireCall[] {
  return calls.filter((call) => call.method !== "GET");
}

/** P1 — one row per code: code, newest version, its vendor, model and register count, and the Unverified pill. */
export async function listsOneRowPerCodeAtItsNewestVersion(): Promise<void> {
  const calls = stubAll();
  renderPage(admin);
  const meter = await profileRow("spec_meter");
  const pump = await profileRow("spec_pump");
  expect(document.querySelectorAll("[data-profile-code]")).toHaveLength(2);

  expect(within(meter).getByText("v3")).toBeInTheDocument();
  expect(within(meter).getByText("Meter Vendor")).toBeInTheDocument();
  expect(within(meter).getByText("MV-2")).toBeInTheDocument();
  expect(within(meter).getByRole("cell", { name: "2" })).toBeInTheDocument();
  expect(within(meter).getByText("Unverified")).toBeInTheDocument();
  expect(within(meter).queryByText("Old Vendor")).toBeNull();
  expect(within(meter).queryByText("Mid Vendor")).toBeNull();

  expect(within(pump).getByText("v1")).toBeInTheDocument();
  expect(within(pump).getByText("Verified")).toBeInTheDocument();
  expect(within(pump).queryByText("Unverified")).toBeNull();

  expect(calls.some((call) => call.method === "GET" && call.path === LIST_PATH)).toBe(true);
}

/** P2 — Edit opens the NEWEST version (v3, listed between v1 and v2) of the code, and Save sends that row's id and version. */
export async function editOpensAndSavesTheNewestVersion(): Promise<void> {
  const calls = stubAll((call) =>
    call.method === "POST" ? { status: 201, body: { ...LIST[1], id: PUMP_V1, version: 4 } } : undefined,
  );
  const user = userEvent.setup();
  renderPage(admin);
  const meter = await profileRow("spec_meter");
  await user.click(within(meter).getByRole("button", { name: "Edit spec_meter" }));
  expect(await screen.findByRole("heading", { name: "Edit spec_meter (from v3)" })).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Vendor" })).toHaveValue("Meter Vendor");
  await user.click(screen.getByRole("button", { name: "Save new version" }));

  await waitFor(() => expect(writes(calls)).toHaveLength(1));
  const [save] = writes(calls) as [WireCall];
  expect(save.method).toBe("POST");
  expect(save.path).toBe(`/admin/device-profiles/${METER_V3}/versions`);
  expect((save.body as { baseVersion: number }).baseVersion).toBe(3);
}

/** P3 — a 409 on Save shows the stale sentence; Reload closes the editor and reads the list again. */
export async function aStaleSaveShowsTheReloadMessage(): Promise<void> {
  const calls = stubAll((call) =>
    call.method === "POST" ? { status: 409, body: { statusCode: 409, message: "stale" } } : undefined,
  );
  const user = userEvent.setup();
  renderPage(admin);
  const meter = await profileRow("spec_meter");
  await user.click(within(meter).getByRole("button", { name: "Edit spec_meter" }));
  await user.click(await screen.findByRole("button", { name: "Save new version" }));
  const alert = await screen.findByText("Someone saved a newer version of this profile while you were editing it.", {
    exact: false,
  });
  const reads = calls.filter((call) => call.path === LIST_PATH).length;
  await user.click(within(alert.closest("[role=alert]") as HTMLElement).getByRole("button", { name: "Reload" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Save new version" })).toBeNull());
  await waitFor(() => expect(calls.filter((call) => call.path === LIST_PATH).length).toBeGreaterThan(reads));
}

/** P4 — Import lists the stock entries, and Import posts the stock code with the organization. */
export async function importListsTheStockEntries(): Promise<void> {
  const calls = stubAll((call) =>
    call.method === "POST" ? { status: 201, body: profile({ id: PUMP_V1, code: "stock_alpha", version: 1 }) } : undefined,
  );
  const user = userEvent.setup();
  renderPage(admin);
  await profileRow("spec_meter");
  expect(calls.some((call) => call.path === "/admin/device-profiles/stock")).toBe(false);
  await user.click(screen.getByRole("button", { name: "Import stock profile" }));

  const panel = await screen.findByRole("region", { name: "Stock profiles" });
  expect(await within(panel).findByText("stock_alpha")).toBeInTheDocument();
  expect(within(panel).getByText("stock_beta")).toBeInTheDocument();
  expect(within(panel).getByText("Alpha Co")).toBeInTheDocument();
  await user.click(within(panel).getByRole("button", { name: "Import stock_alpha" }));

  await waitFor(() => expect(writes(calls)).toHaveLength(1));
  const [imported] = writes(calls) as [WireCall];
  expect(imported.path).toBe("/admin/device-profiles/stock/stock_alpha/import");
  expect(imported.body).toEqual({ organizationId: ORG_ID });
}

/** P5 — Copy asks for a new code, refuses one the code schema refuses, and posts the newest row's id. */
export async function copyAsksForANewCode(): Promise<void> {
  const calls = stubAll((call) =>
    call.method === "POST" ? { status: 201, body: profile({ id: PUMP_V1, code: "meter_copy", version: 1 }) } : undefined,
  );
  const user = userEvent.setup();
  renderPage(admin);
  const meter = await profileRow("spec_meter");
  await user.click(within(meter).getByRole("button", { name: "Copy spec_meter" }));
  const code = await screen.findByRole("textbox", { name: "New code for the copy of spec_meter" });

  await user.type(code, "has space");
  await user.click(screen.getByRole("button", { name: "Create copy" }));
  expect(await screen.findByText("A code is letters, digits, _ and -, at most 64 characters.")).toBeInTheDocument();
  expect(writes(calls)).toHaveLength(0);

  await user.clear(code);
  await user.type(code, "meter_copy");
  await user.click(screen.getByRole("button", { name: "Create copy" }));
  await waitFor(() => expect(writes(calls)).toHaveLength(1));
  const [copy] = writes(calls) as [WireCall];
  expect(copy.path).toBe(`/admin/device-profiles/${METER_V3}/copy`);
  expect(copy.body).toEqual({ code: "meter_copy" });
}

/** P6 — fails closed for a `location_admin`: the sentence, no list, no request at all. */
export async function failsClosedForALocationAdmin(): Promise<void> {
  const calls = stubAll();
  renderPage(locationAdmin);
  expect(
    await screen.findByText("Device profiles are managed by an organization administrator or a global administrator."),
  ).toBeInTheDocument();
  expect(screen.queryByRole("combobox", { name: "Organization" })).toBeNull();
  expect(screen.queryByRole("button", { name: "New profile" })).toBeNull();
  expect(document.querySelectorAll("[data-profile-code]")).toHaveLength(0);
  expect(calls.filter((call) => call.path.startsWith("/admin/device-profiles"))).toHaveLength(0);
  expect(organizationsApi.fetchAdminOrganizations).not.toHaveBeenCalled();
}

/**
 * P7 — a stock code the organization already holds says so ("held at v1"), and its Import asks
 * before it posts: the import would land as v2 of the organization's own code.
 */
export async function importingAHeldCodeAsksFirst(): Promise<void> {
  const calls = stubAll((call) =>
    call.method === "POST" ? { status: 201, body: profile({ id: PUMP_V1, code: "spec_pump", version: 2 }) } : undefined,
  );
  const user = userEvent.setup();
  renderPage(admin);
  await profileRow("spec_meter");
  await user.click(screen.getByRole("button", { name: "Import stock profile" }));
  const panel = await screen.findByRole("region", { name: "Stock profiles" });
  const held = (await within(panel).findByText("spec_pump")).closest("tr") as HTMLElement;
  expect(within(held).getByText("held at v1")).toBeInTheDocument();
  const fresh = within(panel).getByText("stock_alpha").closest("tr") as HTMLElement;
  expect(within(fresh).queryByText(/held at/)).toBeNull();

  await user.click(within(panel).getByRole("button", { name: "Import spec_pump" }));
  expect(
    await within(panel).findByText("This organization holds spec_pump at v1. Importing saves the stock file as v2.", {
      exact: false,
    }),
  ).toBeInTheDocument();
  expect(writes(calls)).toHaveLength(0);
  await user.click(within(panel).getByRole("button", { name: "Import as v2" }));
  await waitFor(() => expect(writes(calls)).toHaveLength(1));
  expect(writes(calls)[0]?.path).toBe("/admin/device-profiles/stock/spec_pump/import");
}

/** P8 — the import panel's messages belong to one organization: switching organization clears them. */
export async function anOrganizationSwitchClearsTheImportMessages(): Promise<void> {
  stubAll((call) =>
    call.method === "POST" ? { status: 201, body: profile({ id: PUMP_V1, code: "stock_alpha", version: 1 }) } : undefined,
  );
  const user = userEvent.setup();
  renderPage(admin);
  await profileRow("spec_meter");
  await user.click(screen.getByRole("button", { name: "Import stock profile" }));
  const panel = await screen.findByRole("region", { name: "Stock profiles" });
  await user.click(await within(panel).findByRole("button", { name: "Import stock_alpha" }));
  expect(await screen.findByText("Imported stock_alpha as v1.")).toBeInTheDocument();

  await user.selectOptions(screen.getByRole("combobox", { name: "Organization" }), ORG_B);
  await screen.findByText("No device profiles yet. Create one, or import a stock profile.");
  expect(screen.getByRole("region", { name: "Stock profiles" })).toBeInTheDocument();
  expect(screen.queryByText("Imported stock_alpha as v1.")).toBeNull();
}
