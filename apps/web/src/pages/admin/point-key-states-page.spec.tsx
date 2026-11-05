import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { AdminPointKeyDto, AdminPointKeyStateDto, AdminPointKeyStatesListResponse } from "@bms/shared";

import * as pointKeysApi from "../../api/admin/point-keys";
import * as api from "../../api/admin/point-key-states";
import * as copilotApi from "../../api/copilot";
import * as systemStatusApi from "../../api/system-status";
import { OPERATIONAL } from "../../components/system-status-indicator.spec";
import { ApiError } from "../../lib/api-error";
import type { AuthUser } from "../../stores/auth-store";
import { PointKeyStatesAdminPage } from "./point-key-states-page";

/**
 * `F4.309` T11 (ADR 0088 Amendment 3 decisions 1–4, plan C14) — the State Labels admin page,
 * rendered (ADR 0042). Assertions live here; `point-key-states-page.test.tsx` is the Vitest entry
 * point and carries the `@vitest-environment jsdom` docblock.
 *
 * Every function of `api/admin/point-key-states` is stubbed, and so are `fetchAdminPointKeys`
 * (the key picker) and the two reads the `MasterDataLayout` → `AppShell` chrome issues (an
 * unstubbed read reaches a local API on `:4000`).
 */

const admin = { id: "u1", email: "admin@bms.local", displayName: "Admin", role: "admin" } as unknown as AuthUser;
const organizationAdmin = {
  id: "u2",
  email: "phe-admin@bms.local",
  displayName: "Org Admin",
  role: "organization_admin",
} as unknown as AuthUser;

/** One seeded row and one admin row; values and labels that appear nowhere else on screen. */
const SEEDED: AdminPointKeyStateDto = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  pointKey: "breaker_main",
  value: 1,
  label: "CLOSED",
  tone: "closed",
  seeded: true,
};
const CUSTOM: AdminPointKeyStateDto = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  pointKey: "isolator_pos",
  value: 2.5,
  label: "EARTHED",
  tone: "open",
  seeded: false,
};
const LIST: AdminPointKeyStatesListResponse = { items: [SEEDED, CUSTOM] };
/** Review L7: a row button names its row, so a screen reader's button list tells the rows apart. */
const EDIT_NAME = "Edit isolator_pos = 2.5";
const DELETE_NAME = "Delete isolator_pos = 2.5";

function pointKey(code: string): AdminPointKeyDto {
  return {
    id: `pk-${code}`,
    code,
    name: code,
    domain: null,
    unit: null,
    description: null,
    active: true,
    createdAt: new Date(0).toISOString(),
    headlineRank: null,
    trendDefault: false,
  };
}
const KEYS = { items: [pointKey("breaker_main"), pointKey("isolator_pos")] };

function renderPage(as: AuthUser): void {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  vi.spyOn(pointKeysApi, "fetchAdminPointKeys").mockResolvedValue(KEYS);
  vi.spyOn(api, "fetchAdminPointKeyStates").mockResolvedValue(LIST);
  vi.spyOn(api, "createAdminPointKeyState").mockResolvedValue(CUSTOM);
  vi.spyOn(api, "updateAdminPointKeyState").mockResolvedValue(CUSTOM);
  vi.spyOn(api, "deleteAdminPointKeyState").mockResolvedValue(undefined);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/point-key-states"]}>
        <PointKeyStatesAdminPage user={as} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function rowOf(label: string): Promise<HTMLElement> {
  const row = (await screen.findByText(label)).closest("tr");
  if (!row) throw new Error(`no row for ${label}`);
  return row;
}

const refusedWith = (status: number, sentence: string) => () =>
  Promise.reject(new ApiError(`{"statusCode":${status},"message":"${sentence}","error":"Refused"}`, status));

/** Opens Add and waits for the key picker to hold the active keys. */
async function openAdd(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await rowOf(CUSTOM.label);
  await user.click(screen.getByRole("button", { name: "Add state label" }));
  const dialog = await screen.findByRole("dialog", { name: "Add state label" });
  await within(dialog).findByRole("option", { name: "isolator_pos" });
  return dialog;
}

async function fillAdd(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
  fields: { key?: string; value: string; label: string; tone?: string },
): Promise<void> {
  await user.selectOptions(within(dialog).getByLabelText("Point key"), fields.key ?? "isolator_pos");
  await user.type(within(dialog).getByLabelText("Value"), fields.value);
  await user.type(within(dialog).getByLabelText("Label"), fields.label);
  await user.selectOptions(within(dialog).getByLabelText("Tone"), fields.tone ?? "open");
}

/** The title, the five column headers, and one row per state label. */
export async function rendersTheColumnsAndOneRowPerItem(): Promise<void> {
  renderPage(admin);
  expect(screen.getByRole("heading", { name: "State Labels" })).toBeInTheDocument();
  const row = await rowOf(CUSTOM.label);
  expect(within(row).getByText(CUSTOM.pointKey)).toBeInTheDocument();
  expect(within(row).getByText("2.5")).toBeInTheDocument();
  expect(within(row).getByText("open")).toBeInTheDocument();
  const table = screen.getByRole("table");
  expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
    "Point key",
    "Value",
    "Label",
    "Tone",
    "Actions",
  ]);
  expect(within(table).getAllByRole("row")).toHaveLength(LIST.items.length + 1);
}

/** A seeded row shows "Seeded" and no control; an admin row beside it has Edit and Delete (the control). */
export async function aSeededRowShowsSeededAndNoControls(): Promise<void> {
  renderPage(admin);
  const seeded = await rowOf(SEEDED.label);
  expect(within(seeded).getByText("Seeded")).toBeInTheDocument();
  expect(within(seeded).queryAllByRole("button")).toHaveLength(0);
  const custom = await rowOf(CUSTOM.label);
  expect(within(custom).queryByText("Seeded")).toBeNull();
  expect(within(custom).getByRole("button", { name: EDIT_NAME })).toBeInTheDocument();
  expect(within(custom).getByRole("button", { name: DELETE_NAME })).toBeInTheDocument();
}

/** The key picker offers the active point keys, read through the shared `"true"` filter. */
export async function theKeyPickerOffersTheActivePointKeys(): Promise<void> {
  const user = userEvent.setup();
  renderPage(admin);
  const dialog = await openAdd(user);
  expect(pointKeysApi.fetchAdminPointKeys).toHaveBeenCalledWith("true");
  const options = within(within(dialog).getByLabelText("Point key")).getAllByRole("option");
  expect(options.map((option) => (option as HTMLOptionElement).value)).toEqual(["", "breaker_main", "isolator_pos"]);
  const tones = within(within(dialog).getByLabelText("Tone")).getAllByRole("option");
  expect(tones.map((option) => (option as HTMLOptionElement).value)).toEqual([
    "closed",
    "open",
    "tripped",
    "flowing",
    "shut",
  ]);
}

/** Add posts the key, the value parsed as a number, the trimmed label and the tone. */
export async function addPostsTheParsedValueAndTheTrimmedLabel(): Promise<void> {
  const user = userEvent.setup();
  renderPage(admin);
  const dialog = await openAdd(user);
  await fillAdd(user, dialog, { value: "-0.5", label: "  RACKED OUT  ", tone: "tripped" });
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.createAdminPointKeyState).toHaveBeenCalledTimes(1));
  expect(api.createAdminPointKeyState).toHaveBeenCalledWith({
    pointKey: "isolator_pos",
    value: -0.5,
    label: "RACKED OUT",
    tone: "tripped",
  });
}

/** A value that is not a finite decimal number is refused before any request: text, blank, Infinity, hex. */
export async function aValueThatIsNotANumberIsRefused(): Promise<void> {
  const user = userEvent.setup();
  renderPage(admin);
  const dialog = await openAdd(user);
  await fillAdd(user, dialog, { value: "two", label: "TWO" });
  const value = within(dialog).getByLabelText("Value");
  for (const text of ["two", " ", "Infinity", "0x1"]) {
    await user.clear(value);
    await user.type(value, text);
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(within(dialog).getByText("Value must be a number")).toBeInTheDocument();
  }
  expect(api.createAdminPointKeyState).toHaveBeenCalledTimes(0);
}

/** The label input stops at 32 characters, the body's `.max(32)`. */
export async function theLabelStopsAtThirtyTwoCharacters(): Promise<void> {
  const user = userEvent.setup();
  renderPage(admin);
  const dialog = await openAdd(user);
  const label = within(dialog).getByLabelText("Label") as HTMLInputElement;
  await user.type(label, "A".repeat(40));
  expect(label.value).toHaveLength(32);
}

/** Edit shows the key and value read-only and sends only `label` and `tone` against the row's id. */
export async function editSendsLabelAndToneOnly(): Promise<void> {
  const user = userEvent.setup();
  renderPage(admin);
  await user.click(within(await rowOf(CUSTOM.label)).getByRole("button", { name: EDIT_NAME }));
  const dialog = await screen.findByRole("dialog", { name: "Edit state label" });
  expect(within(dialog).queryByLabelText("Point key")).toBeNull();
  expect(within(dialog).queryByLabelText("Value")).toBeNull();
  expect(dialog.textContent).toContain(`${CUSTOM.pointKey}`);
  expect(dialog.textContent).toContain("2.5");
  const label = within(dialog).getByLabelText("Label");
  await user.clear(label);
  await user.type(label, " EARTH ");
  await user.selectOptions(within(dialog).getByLabelText("Tone"), "shut");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.updateAdminPointKeyState).toHaveBeenCalledTimes(1));
  expect(api.updateAdminPointKeyState).toHaveBeenCalledWith(CUSTOM.id, { label: "EARTH", tone: "shut" });
}

/** Delete asks first: nothing is sent until the confirm, then the row's id is. */
export async function deleteAsksFirstThenSendsTheId(): Promise<void> {
  const user = userEvent.setup();
  renderPage(admin);
  await user.click(within(await rowOf(CUSTOM.label)).getByRole("button", { name: DELETE_NAME }));
  const confirm = await screen.findByRole("dialog", { name: "Delete state label" });
  expect(confirm.textContent).toContain(CUSTOM.label);
  expect(api.deleteAdminPointKeyState).toHaveBeenCalledTimes(0);
  await user.click(within(confirm).getByRole("button", { name: "Delete state label" }));
  await waitFor(() => expect(api.deleteAdminPointKeyState).toHaveBeenCalledTimes(1));
  expect(api.deleteAdminPointKeyState).toHaveBeenCalledWith(CUSTOM.id);
}

/** Cancel on the confirm sends nothing. */
export async function cancellingTheDeleteSendsNothing(): Promise<void> {
  const user = userEvent.setup();
  renderPage(admin);
  await user.click(within(await rowOf(CUSTOM.label)).getByRole("button", { name: DELETE_NAME }));
  const confirm = await screen.findByRole("dialog", { name: "Delete state label" });
  await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog", { name: "Delete state label" })).toBeNull();
  expect(api.deleteAdminPointKeyState).toHaveBeenCalledTimes(0);
}

/** The query keys a spied `invalidateQueries` was called with, in order. */
function invalidatedKeys(spy: { mock: { calls: readonly (readonly unknown[])[] } }): unknown[] {
  return spy.mock.calls.map((call) => (call[0] as { queryKey?: unknown } | undefined)?.queryKey);
}

/** A save refreshes the list and `/vocabularies` (the legend). */
export async function aSaveInvalidatesTheListAndTheVocabularies(): Promise<void> {
  const invalidate = vi.spyOn(QueryClient.prototype, "invalidateQueries");
  const user = userEvent.setup();
  renderPage(admin);
  await user.click(within(await rowOf(CUSTOM.label)).getByRole("button", { name: EDIT_NAME }));
  const dialog = await screen.findByRole("dialog", { name: "Edit state label" });
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(invalidatedKeys(invalidate)).toContainEqual(["admin", "point-key-states"]));
  expect(invalidatedKeys(invalidate)).toContainEqual(["vocabularies"]);
}

/** A delete refreshes the list and `/vocabularies` too. */
export async function aDeleteInvalidatesTheListAndTheVocabularies(): Promise<void> {
  const invalidate = vi.spyOn(QueryClient.prototype, "invalidateQueries");
  const user = userEvent.setup();
  renderPage(admin);
  await user.click(within(await rowOf(CUSTOM.label)).getByRole("button", { name: DELETE_NAME }));
  await user.click(await screen.findByRole("button", { name: "Delete state label" }));
  await waitFor(() => expect(invalidatedKeys(invalidate)).toContainEqual(["admin", "point-key-states"]));
  expect(invalidatedKeys(invalidate)).toContainEqual(["vocabularies"]);
}

/** A 409 on save shows the server's sentence in the form, not the envelope; the form stays open. */
export async function aRefusedSaveShowsTheSentence(): Promise<void> {
  const user = userEvent.setup();
  renderPage(admin);
  vi.mocked(api.createAdminPointKeyState).mockImplementation(
    refusedWith(409, "A state label for isolator_pos = 3 already exists"),
  );
  const dialog = await openAdd(user);
  await fillAdd(user, dialog, { value: "3", label: "TEST" });
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  const banner = await within(dialog).findByText(/A state label for isolator_pos = 3 already exists/);
  expect(banner.textContent).not.toContain('{"');
}

/** A 400 on delete shows the server's sentence on the page, not the envelope. */
export async function aRefusedDeleteShowsTheSentence(): Promise<void> {
  const user = userEvent.setup();
  renderPage(admin);
  vi.mocked(api.deleteAdminPointKeyState).mockImplementation(refusedWith(400, "That state label cannot be deleted"));
  await user.click(within(await rowOf(CUSTOM.label)).getByRole("button", { name: DELETE_NAME }));
  await user.click(await screen.findByRole("button", { name: "Delete state label" }));
  const banner = await screen.findByText(/That state label cannot be deleted/);
  expect(banner.textContent).not.toContain('{"');
}

/** While a save is in flight its button is named "Saving…", busy and disabled (`F4.164` / `F4.168`). */
export async function aPendingSaveNamesItself(): Promise<void> {
  const user = userEvent.setup();
  renderPage(admin);
  vi.mocked(api.updateAdminPointKeyState).mockImplementation(() => new Promise(() => undefined));
  await user.click(within(await rowOf(CUSTOM.label)).getByRole("button", { name: EDIT_NAME }));
  const dialog = await screen.findByRole("dialog", { name: "Edit state label" });
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  const saving = await within(dialog).findByRole("button", { name: "Saving…" });
  expect(saving).toHaveAttribute("aria-busy", "true");
  expect(saving).toBeDisabled();
}

/** While a delete is in flight the row's button is named "Deleting <row>" and busy, and reads "Deleting…". */
export async function aPendingDeleteNamesItsRow(): Promise<void> {
  const user = userEvent.setup();
  renderPage(admin);
  vi.mocked(api.deleteAdminPointKeyState).mockImplementation(() => new Promise(() => undefined));
  const row = await rowOf(CUSTOM.label);
  await user.click(within(row).getByRole("button", { name: DELETE_NAME }));
  await user.click(await screen.findByRole("button", { name: "Delete state label" }));
  const deleting = await within(row).findByRole("button", { name: "Deleting isolator_pos = 2.5" });
  expect(deleting).toHaveAttribute("aria-busy", "true");
  expect(deleting).toBeDisabled();
  expect(deleting.textContent).toBe("Deleting…");
}

/**
 * Fails closed: an `organization_admin` reaching the URL sees the status line, no table, and
 * neither the list nor the key picker is read. The status line is the positive control; one
 * macrotask lets any mounted query start.
 */
export async function failsClosedForAnOrganizationAdmin(): Promise<void> {
  renderPage(organizationAdmin);
  expect(screen.getByText("State labels are managed by a global administrator.")).toBeInTheDocument();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.queryByRole("button", { name: "Add state label" })).toBeNull();
  expect(api.fetchAdminPointKeyStates).toHaveBeenCalledTimes(0);
  expect(pointKeysApi.fetchAdminPointKeys).toHaveBeenCalledTimes(0);
}
