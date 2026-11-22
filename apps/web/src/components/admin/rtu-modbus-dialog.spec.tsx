import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi, type Mock } from "vitest";

import type { AdminRtuDto } from "@bms/shared";
import type { DeviceProfileDto } from "@bms/shared/contracts";

import * as profilesApi from "../../api/admin/device-profiles";
import * as rtusApi from "../../api/admin/rtus";
import { ApiError } from "../../lib/api-error";
import { POLL_INTERVAL_SLOW_WARNING } from "../../lib/poll-interval-input";
import { RtuModbusDialog } from "./rtu-modbus-dialog";

/**
 * `F1.2` (ADR 0141 decisions 10 and 15, plan T7.4, P4) — the RTU's **Modbus settings** dialog:
 * a profile picker scoped to the RTU's organization, the connection, and an interval field that
 * says what it inherits. Assertions live here; `rtu-modbus-dialog.test.tsx` is the Vitest entry
 * point (ADR 0014, ADR 0042).
 */

const ORG_ID = "44444444-4444-4444-8444-444444444444";
const RTU_ID = "55555555-5555-4555-8555-555555555555";
const P1 = "66666666-6666-4666-8666-666666666661";
const P2 = "66666666-6666-4666-8666-666666666662";

function profile(id: string, code: string, version: number): DeviceProfileDto {
  return {
    id,
    organizationId: ORG_ID,
    protocol: "modbus_tcp",
    code,
    version,
    vendor: "Selec",
    model: "MFM384",
    source: { document: "manual", revision: "1", pages: "1" },
    verified: false,
    registers: [],
    stockCode: null,
    stockVersion: null,
    createdBy: null,
    createdAt: new Date(0).toISOString(),
  };
}

const RTU: AdminRtuDto = {
  id: RTU_ID,
  locationId: "l1",
  locationName: "Plant",
  organizationCode: "ION",
  code: "MB-1",
  displayName: "Main meter",
  sourceType: "catalog",
  domain: null,
  externalRtuId: null,
  rtuCode: "MB1",
  mqttTopic: null,
  releasedMqttTopic: null,
  expectedIntervalSeconds: null,
  stationCode: null,
  stationName: null,
  ingestEnabled: false,
  organizationIngestEnabled: true,
  active: true,
  meta: null,
  createdAt: new Date(0).toISOString(),
  tls: null,
  payloadFormat: null,
  credentialsSet: false,
  modbus: {
    host: "10.0.0.5",
    port: 502,
    unitId: 3,
    timeoutMs: null,
    interRequestDelayMs: null,
    pollIntervalMs: 30_000,
    profile: { code: "selec-mfm384", version: 1 },
    registerCount: 12,
  },
  organizationDefaultPollIntervalMs: 60_000,
};

function stub(profiles: DeviceProfileDto[] = [profile(P2, "selec-mfm384", 2), profile(P1, "selec-mfm384", 1)]): void {
  vi.spyOn(rtusApi, "fetchAdminRtuSummary").mockResolvedValue({
    id: RTU_ID,
    code: RTU.code,
    displayName: RTU.displayName,
    locationId: RTU.locationId,
    locationName: RTU.locationName,
    organizationId: ORG_ID,
    organizationCode: RTU.organizationCode,
  });
  vi.spyOn(profilesApi, "fetchDeviceProfiles").mockResolvedValue(profiles);
}

function renderDialog(rtu: AdminRtuDto = RTU): { onDone: Mock; queryClient: QueryClient } {
  const onDone = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RtuModbusDialog rtu={rtu} onDone={onDone} />
    </QueryClientProvider>,
  );
  return { onDone, queryClient };
}

const INTERVAL = "Poll interval (seconds)";

/** R1 — opens on the stored connection; the picker lists the RTU's organization's profiles, the bound one chosen. */
export async function theDialogOpensOnTheStoredBind(): Promise<void> {
  stub();
  renderDialog();
  const dialog = screen.getByRole("dialog", { name: "Modbus settings — Main meter" });
  expect(dialog).toHaveAttribute("aria-modal", "true");
  const picker = (await screen.findByRole("option", { name: /selec-mfm384 v1/ })).closest("select") as HTMLSelectElement;
  expect(profilesApi.fetchDeviceProfiles).toHaveBeenCalledWith(ORG_ID);
  expect(picker.value).toBe(P1);
  expect([...picker.options].map((o) => o.textContent)).toEqual([
    "Choose a profile",
    "selec-mfm384 v2 — Selec MFM384",
    "selec-mfm384 v1 — Selec MFM384",
  ]);
  expect((screen.getByLabelText("Host") as HTMLInputElement).value).toBe("10.0.0.5");
  expect((screen.getByLabelText("Port") as HTMLInputElement).value).toBe("502");
  expect((screen.getByLabelText("Unit id") as HTMLInputElement).value).toBe("3");
  expect((screen.getByLabelText(INTERVAL) as HTMLInputElement).value).toBe("30");
  // The field says what it inherits: the organization's default here.
  expect(dialog.textContent).toContain("Empty inherits the organization default: 60 s.");
  expect(dialog.textContent).toContain("Bound to selec-mfm384 v1 (12 registers)");
}

/** R2 — an empty interval sends `null`; the body names the profile, never registers; Save refreshes and closes. */
export async function anEmptyIntervalSendsNull(): Promise<void> {
  stub();
  const write = vi.spyOn(rtusApi, "setRtuModbus").mockResolvedValue(RTU);
  const { onDone, queryClient } = renderDialog();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  await screen.findByRole("option", { name: /selec-mfm384 v2/ });
  await userEvent.selectOptions(screen.getByLabelText("Device profile"), P2);
  await userEvent.clear(screen.getByLabelText(INTERVAL));
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  expect(write.mock.calls).toEqual([
    [RTU_ID, { host: "10.0.0.5", port: 502, unitId: 3, pollIntervalMs: null, profileId: P2 }],
  ]);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin", "rtus"] });
}

/** R3 — P4: a value over 360 s shows the warning; an unbound RTU with no organization default says "adapter". */
export async function overSixMinutesWarnsAndTheAdapterDefaultIsNamed(): Promise<void> {
  stub();
  renderDialog({ ...RTU, modbus: null, organizationDefaultPollIntervalMs: null });
  const dialog = screen.getByRole("dialog");
  expect(dialog.textContent).toContain("Empty inherits the adapter default.");
  expect((screen.getByLabelText(INTERVAL) as HTMLInputElement).value).toBe("");
  expect((screen.getByLabelText("Port") as HTMLInputElement).value).toBe("502");
  expect(screen.queryByText(POLL_INTERVAL_SLOW_WARNING)).toBeNull();
  await userEvent.type(screen.getByLabelText(INTERVAL), "361");
  expect(screen.getByText(POLL_INTERVAL_SLOW_WARNING)).toBeInTheDocument();
}

/** R4 — a refusal (the other-organization endpoint 409) shows inline and the dialog stays; no profile chosen sends nothing. */
export async function aRefusalShowsInlineAndStays(): Promise<void> {
  stub();
  const message = "This Modbus endpoint (host and port) is already used by an RTU of another organization; one endpoint serves one organization";
  const write = vi.spyOn(rtusApi, "setRtuModbus").mockRejectedValue(new ApiError(JSON.stringify({ message, statusCode: 409 }), 409));
  const { onDone } = renderDialog({ ...RTU, modbus: null });
  await screen.findByRole("option", { name: /selec-mfm384 v2/ });
  await userEvent.type(screen.getByLabelText("Host"), "10.0.0.9");
  await userEvent.type(screen.getByLabelText("Unit id"), "1");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByText("Choose a device profile.")).toBeInTheDocument();
  expect(write).not.toHaveBeenCalled();
  await userEvent.selectOptions(screen.getByLabelText("Device profile"), P2);
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText(message)).toBeInTheDocument();
  expect(onDone).not.toHaveBeenCalled();
  expect(write.mock.calls[0]?.[1]).toEqual({ host: "10.0.0.9", port: 502, unitId: 1, pollIntervalMs: null, profileId: P2 });
}

/** R5 — an organization with no profile says where to make one, and Save stays off. */
export async function noProfileSaysWhereToMakeOne(): Promise<void> {
  stub([]);
  renderDialog();
  expect(await screen.findByText(/has no device profiles yet/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
}
