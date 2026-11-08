import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { MqttPayloadFormatDto } from "@bms/shared";

import * as api from "../../api/admin/mqtt-payload-formats";
import * as copilotApi from "../../api/copilot";
import * as systemStatusApi from "../../api/system-status";
import { OPERATIONAL } from "../../components/system-status-indicator.spec";
import type { AuthUser } from "../../stores/auth-store";
import { DEFINITION_NOT_JSON, PAYLOAD_SAMPLE_COPILOT_NOTE, PayloadFormatsAdminPage } from "./payload-formats-page";

/**
 * `F4.334` (plan T5.2, ADR 0099 Amendment 17) — the Payload Formats page: fails closed for a
 * tenant admin, the Built-in row has no control, New opens the `mqttPayloadFormat.create`
 * wizard, invalid JSON is refused in the page's words, the test box decodes the BCPL sample,
 * and a delete refused with the in-use 409 lists the RTUs. The API is spied.
 */

const admin = { id: "u1", email: "admin@bms.local", displayName: "Admin", role: "admin" } as unknown as AuthUser;
const organizationAdmin = { id: "u2", email: "o@bms.local", displayName: "Org", role: "organization_admin" } as unknown as AuthUser;

const BUILTIN: MqttPayloadFormatDto = {
  id: "00000000-0000-4000-8000-000000000001",
  code: "thinkiot-envelope",
  name: "ThinkIoT envelope",
  description: "",
  definition: { kind: "builtin", name: "thinkiot-envelope" },
  builtin: true,
  createdAt: "2026-11-08T00:00:00.000Z",
  updatedAt: "2026-11-08T00:00:00.000Z",
  updatedBy: null,
};
const BCPL: MqttPayloadFormatDto = {
  ...BUILTIN,
  id: "00000000-0000-4000-8000-000000000002",
  code: "thinkiot-register-array",
  name: "ThinkIoT register array",
  builtin: false,
  definition: {
    kind: "declarative",
    root: "array",
    deviceKey: ["TagName"],
    wordOrder: "big",
    byteOrder: "big",
    readings: [{ key: "treated_water_flow_klh", register: { path: ["Data"], index: 0, type: "float32" } }],
  },
};

function renderPage(as: AuthUser): void {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  vi.spyOn(api, "fetchMqttPayloadFormats").mockResolvedValue([BUILTIN, BCPL]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/payload-formats"]}>
        <PayloadFormatsAdminPage user={as} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function rowOf(code: string): Promise<HTMLElement> {
  const row = (await screen.findByText(code)).closest("tr");
  if (!row) throw new Error(`no row for ${code}`);
  return row;
}

/** P1 — a tenant admin sees the status line and no catalog read runs. */
export async function aTenantAdminSeesTheStatusLine(): Promise<void> {
  renderPage(organizationAdmin);
  expect(await screen.findByRole("status")).toHaveTextContent("Payload formats are managed by a global administrator.");
  expect(api.fetchMqttPayloadFormats).not.toHaveBeenCalled();
}

/** P2 — the built-in row is pilled and has no control; the other row has Edit and Delete; the copilot note shows. */
export async function theBuiltinRowHasNoControl(): Promise<void> {
  renderPage(admin);
  const builtin = await rowOf("thinkiot-envelope");
  expect(within(builtin).getByText("Built-in")).toBeInTheDocument();
  expect(within(builtin).queryByRole("button")).toBeNull();
  const bcpl = await rowOf("thinkiot-register-array");
  expect(within(bcpl).getByRole("button", { name: "Edit thinkiot-register-array" })).toBeInTheDocument();
  expect(screen.getByText(PAYLOAD_SAMPLE_COPILOT_NOTE)).toBeInTheDocument();
}

/** P3 — New format: the Definition step refuses text that is not JSON, in the page's words. */
export async function invalidJsonIsRefused(): Promise<void> {
  const user = userEvent.setup();
  renderPage(admin);
  await rowOf("thinkiot-envelope");
  await user.click(screen.getByRole("button", { name: "New format" }));
  const dialog = await screen.findByRole("dialog", { name: "New payload format" });
  await user.type(within(dialog).getByLabelText("Code"), "acme-json");
  await user.type(within(dialog).getByLabelText("Name"), "Acme");
  await user.click(within(dialog).getByRole("button", { name: "Next" }));
  const textarea = await within(dialog).findByLabelText("Definition (JSON)");
  await user.clear(textarea);
  await user.type(textarea, "not json");
  await user.click(within(dialog).getByRole("button", { name: "Next" }));
  expect(await within(dialog).findByText(DEFINITION_NOT_JSON, { exact: false })).toBeInTheDocument();
}

/** P4 — the test box sends the edited definition and renders the decoded values. */
export async function theTestBoxDecodesTheSample(): Promise<void> {
  const user = userEvent.setup();
  const test = vi.spyOn(api, "testMqttPayloadFormat").mockResolvedValue({
    ok: true,
    records: [{ deviceKey: "BCPL_LAKWA_02", at: "2026-11-07T18:59:46.000Z", values: { treated_water_flow_klh: 1.2999999523162842 } }],
  });
  renderPage(admin);
  await user.click(within(await rowOf("thinkiot-register-array")).getByRole("button", { name: "Edit thinkiot-register-array" }));
  const dialog = await screen.findByRole("dialog", { name: "Edit payload format" });
  await user.click(within(dialog).getByRole("button", { name: "Next" }));
  const sample = await within(dialog).findByLabelText("Sample message");
  await user.click(sample);
  await user.paste('[{"Data":[16294,26214],"TagName":"BCPL_LAKWA_02"}]');
  await user.click(within(dialog).getByRole("button", { name: "Decode sample" }));
  expect(await within(dialog).findByText("treated_water_flow_klh = 1.2999999523162842")).toBeInTheDocument();
  expect(test.mock.calls[0]?.[0].definition).toEqual(BCPL.definition);
}

/** P5 — a delete the route refuses as in use lists the RTUs (ruling Q5). */
export async function anInUseDeleteListsTheRtus(): Promise<void> {
  const user = userEvent.setup();
  vi.spyOn(api, "deleteMqttPayloadFormat").mockRejectedValue(
    new api.MqttPayloadFormatInUseError({
      message: "in use",
      rtus: [{ rtuCode: "BCPL_LAKWA_02", organizationCode: "BCPL" }],
      drafts: [],
    }),
  );
  renderPage(admin);
  await user.click(within(await rowOf("thinkiot-register-array")).getByRole("button", { name: "Delete thinkiot-register-array" }));
  const dialog = await screen.findByRole("dialog", { name: "Delete payload format" });
  await user.click(await within(dialog).findByRole("button", { name: "Submit" }));
  await waitFor(() =>
    expect(within(dialog).getByText(/used by 1 RTU\(s\) and 0 draft\(s\).*BCPL_LAKWA_02 \(BCPL\)/)).toBeInTheDocument(),
  );
}
