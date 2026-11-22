import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import type { DeviceProfileDto } from "@bms/shared/contracts";

import { DeviceProfileEditor } from "./device-profile-editor";
import { ORG_ID, profile, register, stubWire, type WireCall } from "./device-profile-test-fixtures";

/**
 * `F1.2` (ADR 0141 decision 13, plan T6.1, ruling P12b) — the device profile
 * editor, rendered. Assertions live here; `device-profile-editor.test.tsx` is
 * the Vitest entry point with the jsdom docblock (ADR 0042).
 *
 * Every request is read on the wire (`stubWire`), so "Save posts a new version
 * and never a PATCH" is a claim about the request, not about a mocked function.
 * Row messages are the shared schema's own text (`modbusRegisterSchema`,
 * `modbusRegistersSchema`): the server's 400 is flattened and loses the row
 * index, so the row a message belongs to can only come from the client.
 */

const PROFILE_ID = "33333333-3333-4333-8333-333333333333";

const BASE: DeviceProfileDto = profile({
  id: PROFILE_ID,
  code: "spec_meter",
  version: 3,
  registers: [
    register({ sourceKey: "kwh_total", address: 0, type: "float32" }),
    register({ sourceKey: "voltage_l1", address: 10, scale: 0.1, unit: "V" }),
  ],
});

const COIL_MESSAGE = "a coil or discrete input register holds one bit; its type must be bool";
const DUPLICATE_MESSAGE = "two registers of one device may not share a sourceKey";

function renderEditor(base: DeviceProfileDto | null, handlers: { onClose?: () => void; onReload?: () => void } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DeviceProfileEditor
        organizationId={ORG_ID}
        base={base}
        onClose={handlers.onClose ?? (() => undefined)}
        onReload={handlers.onReload ?? (() => undefined)}
      />
    </QueryClientProvider>,
  );
}

/** The `<tbody>` of one register row, 1-based as on screen. */
function row(n: number): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-register-row="${n}"]`);
  if (!found) throw new Error(`no register row ${n}`);
  return found;
}

function rowCount(): number {
  return document.querySelectorAll("[data-register-row]").length;
}

function writes(calls: readonly WireCall[]): WireCall[] {
  return calls.filter((call) => call.method !== "GET");
}

function savedReply(call: WireCall) {
  return call.method === "POST" ? { status: 201, body: { ...BASE, id: "44444444-4444-4444-8444-444444444444", version: 4 } } : undefined;
}

/** E1 — Add, edit and Remove change the register list Save sends, in order. */
export async function addsEditsAndRemovesARegisterRow(): Promise<void> {
  const calls = stubWire(savedReply);
  const onClose = vi.fn();
  const user = userEvent.setup();
  renderEditor(BASE, { onClose });
  expect(rowCount()).toBe(2);

  await user.click(screen.getByRole("button", { name: "Add register" }));
  expect(rowCount()).toBe(3);
  await user.type(within(row(3)).getByRole("textbox", { name: "Source key, row 3" }), "pf_total");
  await user.selectOptions(within(row(3)).getByRole("combobox", { name: "Table, row 3" }), "input");
  await user.type(within(row(3)).getByRole("spinbutton", { name: "Address, row 3" }), "40");
  await user.selectOptions(within(row(3)).getByRole("combobox", { name: "Type, row 3" }), "int16");
  const scale = within(row(3)).getByRole("spinbutton", { name: "Scale, row 3" });
  await user.clear(scale);
  await user.type(scale, "0.001");

  // Edit row 2 in place, then remove row 1.
  const unit = within(row(2)).getByRole("textbox", { name: "Unit, row 2" });
  await user.clear(unit);
  await user.type(unit, "kV");
  await user.click(within(row(1)).getByRole("button", { name: "Remove row 1" }));
  expect(rowCount()).toBe(2);

  await user.click(screen.getByRole("button", { name: "Save new version" }));
  await waitFor(() => expect(writes(calls)).toHaveLength(1));
  const [save] = writes(calls) as [WireCall];
  expect(save.body).toEqual({
    baseVersion: 3,
    vendor: BASE.vendor,
    model: BASE.model,
    source: BASE.source,
    registers: [
      { sourceKey: "voltage_l1", table: "holding", address: 10, type: "uint16", wordOrder: "big", byteSwap: false, scale: 0.1, offset: 0, unit: "kV" },
      { sourceKey: "pf_total", table: "input", address: 40, type: "int16", wordOrder: "big", byteSwap: false, scale: 0.001, offset: 0 },
    ],
  });
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
}

/** E2 — a row the shared register schema refuses shows that schema's message, on that row only; nothing is sent. */
export async function showsTheSharedSchemasMessageOnTheFailingRow(): Promise<void> {
  const calls = stubWire(savedReply);
  const user = userEvent.setup();
  renderEditor(BASE);
  await user.selectOptions(within(row(2)).getByRole("combobox", { name: "Table, row 2" }), "coil");

  expect(await within(row(2)).findByText(COIL_MESSAGE, { exact: false })).toBeInTheDocument();
  expect(row(2)).toHaveAttribute("data-invalid", "true");
  expect(within(row(1)).queryByText(COIL_MESSAGE, { exact: false })).toBeNull();
  expect(row(1)).not.toHaveAttribute("data-invalid");

  await user.click(screen.getByRole("button", { name: "Save new version" }));
  expect(await screen.findByText("Fix the marked rows before saving.")).toBeInTheDocument();
  expect(writes(calls)).toHaveLength(0);
}

/** E3 — a `sourceKey` used twice marks the SECOND row with the shared list schema's message. */
export async function aDuplicateSourceKeyMarksTheSecondRow(): Promise<void> {
  const calls = stubWire(savedReply);
  const user = userEvent.setup();
  renderEditor(BASE);
  const key = within(row(2)).getByRole("textbox", { name: "Source key, row 2" });
  await user.clear(key);
  await user.type(key, "kwh_total");

  expect(await within(row(2)).findByText(DUPLICATE_MESSAGE, { exact: false })).toBeInTheDocument();
  expect(row(2)).toHaveAttribute("data-invalid", "true");
  expect(within(row(1)).queryByText(DUPLICATE_MESSAGE, { exact: false })).toBeNull();
  expect(row(1)).not.toHaveAttribute("data-invalid");

  await user.click(screen.getByRole("button", { name: "Save new version" }));
  expect(writes(calls)).toHaveLength(0);
}

/**
 * E4 — Save on an opened profile is `POST /admin/device-profiles/:id/versions`
 * with the opened row's version as `baseVersion`: one request, never a PATCH,
 * PUT or DELETE, and no server-owned field in the body.
 */
export async function savePostsANewVersionAndNeverAPatch(): Promise<void> {
  const calls = stubWire(savedReply);
  const user = userEvent.setup();
  renderEditor(BASE);
  const vendor = screen.getByRole("textbox", { name: "Vendor" });
  await user.clear(vendor);
  await user.type(vendor, "Renamed Vendor");
  await user.click(screen.getByRole("button", { name: "Save new version" }));

  await waitFor(() => expect(writes(calls)).toHaveLength(1));
  const [save] = writes(calls) as [WireCall];
  expect(save.method).toBe("POST");
  expect(save.path).toBe(`/admin/device-profiles/${PROFILE_ID}/versions`);
  expect(calls.some((call) => ["PATCH", "PUT", "DELETE"].includes(call.method))).toBe(false);
  const body = save.body as Record<string, unknown>;
  expect(body.baseVersion).toBe(BASE.version);
  expect(body.vendor).toBe("Renamed Vendor");
  for (const owned of ["version", "verified", "code", "organizationId", "stockCode", "createdBy"]) {
    expect(body, owned).not.toHaveProperty(owned);
  }
}

/** E5 — a new profile is `POST /admin/device-profiles` with the organization and the code. */
export async function aNewProfilePostsVersionOne(): Promise<void> {
  const calls = stubWire(savedReply);
  const user = userEvent.setup();
  renderEditor(null);
  await user.type(screen.getByRole("textbox", { name: "Code" }), "new_meter");
  await user.type(screen.getByRole("textbox", { name: "Vendor" }), "Acme");
  await user.type(screen.getByRole("textbox", { name: "Model" }), "A-1");
  await user.type(screen.getByRole("textbox", { name: "Manual" }), "A-1 manual");
  await user.type(screen.getByRole("textbox", { name: "Revision" }), "1");
  await user.type(screen.getByRole("textbox", { name: "Pages" }), "4");
  expect(rowCount()).toBe(1);
  await user.type(within(row(1)).getByRole("textbox", { name: "Source key, row 1" }), "kwh_total");
  await user.type(within(row(1)).getByRole("spinbutton", { name: "Address, row 1" }), "0");
  await user.click(screen.getByRole("button", { name: "Create profile" }));

  await waitFor(() => expect(writes(calls)).toHaveLength(1));
  const [create] = writes(calls) as [WireCall];
  expect(create.method).toBe("POST");
  expect(create.path).toBe("/admin/device-profiles");
  expect(create.body).toEqual({
    organizationId: ORG_ID,
    code: "new_meter",
    vendor: "Acme",
    model: "A-1",
    source: { document: "A-1 manual", revision: "1", pages: "4" },
    registers: [
      { sourceKey: "kwh_total", table: "holding", address: 0, type: "uint16", wordOrder: "big", byteSwap: false, scale: 1, offset: 0 },
    ],
  });
}

/**
 * E6 — a 409 on save (someone saved a newer version from the same base) shows
 * the stale sentence and a Reload that hands back to the page; the edit is not
 * retried.
 */
export async function aConflictShowsTheStaleMessage(): Promise<void> {
  const calls = stubWire((call) =>
    call.method === "POST"
      ? { status: 409, body: { statusCode: 409, message: "This profile has a newer version than the one you edited" } }
      : undefined,
  );
  const onReload = vi.fn();
  const onClose = vi.fn();
  const user = userEvent.setup();
  renderEditor(BASE, { onReload, onClose });
  await user.click(screen.getByRole("button", { name: "Save new version" }));

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Someone saved a newer version of this profile while you were editing it.");
  expect(onClose).not.toHaveBeenCalled();
  await user.click(within(alert).getByRole("button", { name: "Reload" }));
  expect(onReload).toHaveBeenCalledTimes(1);
  expect(writes(calls)).toHaveLength(1);
}

/**
 * E7 — the duplicate message lands on the row ON SCREEN, not on its index among the rows that
 * passed: row 1 fails on its own (blank address), so rows 2 and 3 are entries 0 and 1 of the
 * list check, and the message belongs on row 3.
 */
export async function aDuplicateAfterAFailingRowMarksTheRowOnScreen(): Promise<void> {
  const calls = stubWire(savedReply);
  const user = userEvent.setup();
  renderEditor(
    profile({
      id: PROFILE_ID,
      code: "spec_meter",
      version: 3,
      registers: [
        register({ sourceKey: "first", address: 0 }),
        register({ sourceKey: "kw", address: 2 }),
        register({ sourceKey: "kw", address: 4 }),
      ],
    }),
  );
  await user.clear(within(row(1)).getByRole("spinbutton", { name: "Address, row 1" }));
  await user.click(screen.getByRole("button", { name: "Save new version" }));

  expect(await within(row(3)).findByText(DUPLICATE_MESSAGE, { exact: false })).toBeInTheDocument();
  expect(within(row(2)).queryByText(DUPLICATE_MESSAGE, { exact: false })).toBeNull();
  expect(row(1)).toHaveAttribute("data-invalid", "true");
  expect(row(2)).not.toHaveAttribute("data-invalid");
  expect(writes(calls)).toHaveLength(0);
}

/** E8 — a 409 on CREATE is the server's sentence (a code taken), not the stale message, and offers no Reload. */
export async function aConflictOnCreateShowsTheServersSentence(): Promise<void> {
  stubWire((call) =>
    call.method === "POST"
      ? { status: 409, body: { statusCode: 409, message: 'A device profile with code "new_meter" already exists' } }
      : undefined,
  );
  const user = userEvent.setup();
  renderEditor(null);
  await user.type(screen.getByRole("textbox", { name: "Code" }), "new_meter");
  await user.type(screen.getByRole("textbox", { name: "Vendor" }), "Acme");
  await user.type(screen.getByRole("textbox", { name: "Model" }), "A-1");
  await user.type(screen.getByRole("textbox", { name: "Manual" }), "A-1 manual");
  await user.type(screen.getByRole("textbox", { name: "Revision" }), "1");
  await user.type(screen.getByRole("textbox", { name: "Pages" }), "4");
  await user.type(within(row(1)).getByRole("textbox", { name: "Source key, row 1" }), "kwh_total");
  await user.type(within(row(1)).getByRole("spinbutton", { name: "Address, row 1" }), "0");
  await user.click(screen.getByRole("button", { name: "Create profile" }));

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent('A device profile with code "new_meter" already exists');
  expect(alert).not.toHaveTextContent("Someone saved a newer version");
  expect(within(alert).queryByRole("button", { name: "Reload" })).toBeNull();
}

/** E9 — a list-level issue (more than 256 rows) shows a list-level message, not "Fix the marked rows" with none marked. */
export async function aListLevelIssueShowsAListMessage(): Promise<void> {
  const calls = stubWire(savedReply);
  const user = userEvent.setup();
  renderEditor(
    profile({
      id: PROFILE_ID,
      code: "spec_meter",
      version: 3,
      registers: Array.from({ length: 257 }, (_, index) => register({ sourceKey: `k${index}`, address: index })),
    }),
  );
  await user.click(screen.getByRole("button", { name: "Save new version" }));
  expect(await screen.findByText("A profile holds at most 256 registers.")).toBeInTheDocument();
  expect(screen.queryByText("Fix the marked rows before saving.")).toBeNull();
  expect(document.querySelectorAll('[data-invalid="true"]')).toHaveLength(0);
  expect(writes(calls)).toHaveLength(0);
}

/** E10 — a new profile's Code is checked trimmed, and a refused code shows the code rule, not zod's "Invalid". */
export async function theNewCodeIsCheckedTrimmedWithTheCodeRule(): Promise<void> {
  const calls = stubWire(savedReply);
  const user = userEvent.setup();
  renderEditor(null);
  const code = screen.getByRole("textbox", { name: "Code" });
  await user.type(code, "has space");
  await user.click(screen.getByRole("button", { name: "Create profile" }));
  expect(await screen.findByText("A code is letters, digits, _ and -, at most 64 characters.")).toBeInTheDocument();
  expect(screen.queryByText("Invalid")).toBeNull();

  await user.clear(code);
  await user.type(code, "  new_meter  ");
  await user.type(screen.getByRole("textbox", { name: "Vendor" }), "Acme");
  await user.type(screen.getByRole("textbox", { name: "Model" }), "A-1");
  await user.type(screen.getByRole("textbox", { name: "Manual" }), "A-1 manual");
  await user.type(screen.getByRole("textbox", { name: "Revision" }), "1");
  await user.type(screen.getByRole("textbox", { name: "Pages" }), "4");
  await user.type(within(row(1)).getByRole("textbox", { name: "Source key, row 1" }), "kwh_total");
  await user.type(within(row(1)).getByRole("spinbutton", { name: "Address, row 1" }), "0");
  await user.click(screen.getByRole("button", { name: "Create profile" }));
  await waitFor(() => expect(writes(calls)).toHaveLength(1));
  expect((writes(calls)[0]?.body as { code: string }).code).toBe("new_meter");
}
