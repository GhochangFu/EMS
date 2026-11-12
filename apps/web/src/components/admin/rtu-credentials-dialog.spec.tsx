import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { AdminRtuDto } from "@bms/shared";

import * as locationsApi from "../../api/admin/locations";
import * as organizationsApi from "../../api/admin/organizations";
import * as rtusApi from "../../api/admin/rtus";
import * as copilotApi from "../../api/copilot";
import * as deviceHealthApi from "../../api/device-health";
import * as systemStatusApi from "../../api/system-status";
import { ApiError } from "../../lib/api-error";
import { RtusAdminPage } from "../../pages/admin/rtus-page";
import type { AuthUser } from "../../stores/auth-store";
import { OPERATIONAL } from "../system-status-indicator.spec";
import { RtuCredentialsDialog } from "./rtu-credentials-dialog";

/**
 * `F4.333` (ADR 0129 decisions 2, 3 and 6; plan T4.1, T4.2) — the "Replace
 * credentials" action on `/admin/rtus` and its dialog. Write-only: empty
 * fields, a masked password, siblings pre-ticked, the values never kept.
 */

const SECRET = "rotated-secret";
const USER = "bcpl-user";

function rtu(overrides: Partial<AdminRtuDto> = {}): AdminRtuDto {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    locationId: "11111111-1111-4111-8111-111111111111",
    locationName: "Lalmati",
    organizationCode: "BCPL",
    code: "LALRLY1",
    displayName: "Lalmati railway 1",
    sourceType: "mqtt",
    domain: null,
    externalRtuId: null,
    rtuCode: null,
    mqttTopic: null,
    releasedMqttTopic: null,
    expectedIntervalSeconds: null,
    stationCode: null,
    stationName: null,
    ingestEnabled: true,
    organizationIngestEnabled: true,
    active: true,
    meta: null,
    createdAt: new Date(0).toISOString(),
    tls: false,
    payloadFormat: null,
    credentialsSet: true,
    ...overrides,
  };
}

const SIBLINGS = {
  items: [
    { id: "33333333-3333-4333-8333-333333333333", code: "LALRLY2", displayName: "Lalmati railway 2" },
    { id: "44444444-4444-4444-8444-444444444444", code: "LALRLY3", displayName: "Lalmati railway 3" },
  ],
};

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function renderDialog(onDone = vi.fn()): { qc: QueryClient; onDone: ReturnType<typeof vi.fn> } {
  const qc = client();
  render(
    <QueryClientProvider client={qc}>
      <RtuCredentialsDialog rtu={rtu()} onDone={onDone} />
    </QueryClientProvider>,
  );
  return { qc, onDone };
}

/** D1 — empty fields, a masked password, autocomplete off, and every sibling pre-ticked. */
export async function theDialogStartsEmptyWithSiblingsTicked(): Promise<void> {
  vi.spyOn(rtusApi, "fetchRtuCredentialSiblings").mockResolvedValue(SIBLINGS);
  renderDialog();
  const username = screen.getByLabelText("Username") as HTMLInputElement;
  const password = screen.getByLabelText("Password") as HTMLInputElement;
  expect([username.value, password.value]).toEqual(["", ""]);
  expect(password.type).toBe("password");
  expect(username.autocomplete).toBe("off");
  expect(screen.getByText(/The current credential is never shown/)).toBeTruthy();
  await waitFor(() => expect((screen.getByLabelText(/LALRLY2/) as HTMLInputElement).checked).toBe(true));
  expect((screen.getByLabelText(/LALRLY3/) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole("button", { name: "Replace credentials" }) as HTMLButtonElement).disabled).toBe(true);
}

/** D2 — submit sends the body once with the ticked siblings; success clears, closes, and caches no value. */
export async function submitSendsOnceAndKeepsNothing(): Promise<void> {
  vi.spyOn(rtusApi, "fetchRtuCredentialSiblings").mockResolvedValue(SIBLINGS);
  const replace = vi.spyOn(rtusApi, "replaceRtuCredentials").mockResolvedValue(rtu());
  const { qc, onDone } = renderDialog();
  await waitFor(() => expect((screen.getByLabelText(/LALRLY3/) as HTMLInputElement).checked).toBe(true));
  await userEvent.click(screen.getByLabelText(/LALRLY3/));
  await userEvent.type(screen.getByLabelText("Username"), USER);
  await userEvent.type(screen.getByLabelText("Password"), SECRET);
  await userEvent.click(screen.getByRole("button", { name: "Replace credentials" }));
  await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  expect(replace).toHaveBeenCalledTimes(1);
  expect(replace.mock.calls[0]).toEqual([
    rtu().id,
    { username: USER, password: SECRET, alsoApplyTo: ["33333333-3333-4333-8333-333333333333"] },
  ]);
  await waitFor(() => {
    const cached = JSON.stringify([
      qc.getQueryCache().getAll().map((q) => q.state.data),
      qc.getMutationCache().getAll().map((m) => m.state.variables),
    ]);
    expect(cached).not.toContain(SECRET);
  });
}

/** D3 — a refusal shows the API's sentence and clears the typed values. */
export async function aRefusalIsShownAndTheFieldsClear(): Promise<void> {
  vi.spyOn(rtusApi, "fetchRtuCredentialSiblings").mockResolvedValue({ items: [] });
  const sentence = "This RTU is served by an edge gateway. Its broker credential is in the gateway's config file; change it there.";
  vi.spyOn(rtusApi, "replaceRtuCredentials").mockRejectedValue(new ApiError(JSON.stringify({ message: sentence, statusCode: 409 }), 409));
  const { qc, onDone } = renderDialog();
  await userEvent.type(screen.getByLabelText("Username"), USER);
  await userEvent.type(screen.getByLabelText("Password"), SECRET);
  // Security review L1: the password never reaches the markup's `value` attribute.
  expect(screen.getByLabelText("Password").getAttribute("value")).not.toBe(SECRET);
  expect(document.body.innerHTML).not.toContain(SECRET);
  await userEvent.click(screen.getByRole("button", { name: "Replace credentials" }));
  expect((await screen.findByRole("alert")).textContent).toContain("edge gateway");
  expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
  expect((screen.getByLabelText("Username") as HTMLInputElement).value).toBe("");
  expect(onDone).not.toHaveBeenCalled();
  // Code review A: on failure too, nothing typed stays in a cache while the dialog is open.
  await waitFor(() => {
    const cached = JSON.stringify(qc.getMutationCache().getAll().map((m) => m.state.variables));
    expect(cached).not.toContain(SECRET);
  });
}

/** D5 — security review L2: a refetch never re-ticks a sibling the user unticked. */
export async function aRefetchKeepsTheUsersUnticks(): Promise<void> {
  const fetchSiblings = vi.spyOn(rtusApi, "fetchRtuCredentialSiblings").mockResolvedValue(SIBLINGS);
  const { qc } = renderDialog();
  await waitFor(() => expect((screen.getByLabelText(/LALRLY3/) as HTMLInputElement).checked).toBe(true));
  await userEvent.click(screen.getByLabelText(/LALRLY3/));
  fetchSiblings.mockResolvedValue({ items: [...SIBLINGS.items, { id: "66666666-6666-4666-8666-666666666666", code: "LALRLY4", displayName: "Lalmati railway 4" }] });
  await qc.refetchQueries();
  await waitFor(() => expect((screen.getByLabelText(/LALRLY4/) as HTMLInputElement).checked).toBe(true));
  expect((screen.getByLabelText(/LALRLY3/) as HTMLInputElement).checked).toBe(false);
}

/** D6 — code review 1: a failed sibling read is shown and blocks the save, so no target-only replace goes out. */
export async function aFailedSiblingReadBlocksTheSave(): Promise<void> {
  vi.spyOn(rtusApi, "fetchRtuCredentialSiblings").mockRejectedValue(new Error("network"));
  const replace = vi.spyOn(rtusApi, "replaceRtuCredentials").mockResolvedValue(rtu());
  renderDialog();
  await userEvent.type(screen.getByLabelText("Username"), USER);
  await userEvent.type(screen.getByLabelText("Password"), SECRET);
  expect((await screen.findByRole("alert")).textContent).toContain("could not be loaded");
  expect((screen.getByRole("button", { name: "Replace credentials" }) as HTMLButtonElement).disabled).toBe(true);
  expect(replace).not.toHaveBeenCalled();
}

/** D7 — code review 2: more than the PUT's 100 siblings ticked blocks the save with a sentence. */
export async function tooManySiblingsBlockTheSave(): Promise<void> {
  const many = Array.from({ length: 101 }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    code: `R${i}`,
    displayName: `RTU ${i}`,
  }));
  vi.spyOn(rtusApi, "fetchRtuCredentialSiblings").mockResolvedValue({ items: many });
  renderDialog();
  await userEvent.type(screen.getByLabelText("Username"), USER);
  await userEvent.type(screen.getByLabelText("Password"), "x");
  expect((await screen.findByText(/At most 100 other RTUs at once/)).textContent).toContain("untick some");
  expect((screen.getByRole("button", { name: "Replace credentials" }) as HTMLButtonElement).disabled).toBe(true);
}

/** D4 — Cancel clears and closes without a request. */
export async function cancelSendsNothing(): Promise<void> {
  vi.spyOn(rtusApi, "fetchRtuCredentialSiblings").mockResolvedValue({ items: [] });
  const replace = vi.spyOn(rtusApi, "replaceRtuCredentials").mockResolvedValue(rtu());
  const { onDone } = renderDialog();
  await userEvent.type(screen.getByLabelText("Password"), SECRET);
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onDone).toHaveBeenCalledTimes(1);
  expect(replace).not.toHaveBeenCalled();
}

function renderPage(role: string, items: AdminRtuDto[]): void {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(organizationsApi, "fetchAdminOrganizations").mockResolvedValue({ items: [] } as never);
  vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue({ items: [] } as never);
  vi.spyOn(locationsApi, "fetchAdminLocationSummary").mockResolvedValue({} as never);
  vi.spyOn(rtusApi, "fetchAdminRtus").mockResolvedValue({ items } as never);
  vi.spyOn(deviceHealthApi, "fetchDeviceHealth").mockRejectedValue(new Error("not under test"));
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  const user = { id: "u1", email: "x@bms.local", displayName: "X", role } as unknown as AuthUser;
  render(
    <QueryClientProvider client={client()}>
      <MemoryRouter initialEntries={["/admin/rtus"]}>
        <RtusAdminPage user={user} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function rowOf(code: string): Promise<HTMLElement> {
  const row = (await screen.findByText(code)).closest("tr");
  if (!row) throw new Error(`no row for ${code}`);
  return row;
}

/** P1 — the action on an MQTT row for admin and organization_admin; the "Credentials set" pill from the DTO. */
export async function theActionShowsForTheTwoRoles(): Promise<void> {
  for (const role of ["admin", "organization_admin"]) {
    renderPage(role, [
      rtu(),
      rtu({ id: "55555555-5555-4555-8555-555555555555", code: "MB-1", tls: null, credentialsSet: null }),
      // Code review B: an MQTT RTU with no stored credential shows no pill.
      rtu({ id: "77777777-7777-4777-8777-777777777777", code: "LALRLY9", credentialsSet: false }),
    ]);
    const mqtt = await rowOf("LALRLY1");
    expect(mqtt.textContent).toContain("Replace credentials");
    expect(mqtt.textContent).toContain("Credentials set");
    const modbus = await rowOf("MB-1");
    expect(modbus.textContent).not.toContain("Replace credentials");
    expect(modbus.textContent).not.toContain("Credentials set");
    const unset = await rowOf("LALRLY9");
    expect(unset.textContent).toContain("Replace credentials");
    expect(unset.textContent).not.toContain("Credentials set");
    cleanup();
  }
}

/** P2 — not for location_admin (ruling Q4). */
export async function theActionIsHiddenForALocationAdmin(): Promise<void> {
  renderPage("location_admin", [rtu()]);
  const row = await rowOf("LALRLY1");
  expect(row.textContent).not.toContain("Replace credentials");
}
