import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { MimicLayoutsListResponse } from "@bms/shared";

import * as api from "../../api/mimic-layouts";
import * as systemStatusApi from "../../api/system-status";
import { OPERATIONAL } from "../../components/system-status-indicator.spec";
import { ApiError } from "../../lib/api-error";
import type { AuthUser } from "../../stores/auth-store";
import { MimicLayoutsPage } from "./mimic-layouts-page";

/**
 * `F3.32c` U6c — the mimic layout library page, rendered. `mimic-layouts-page.test.tsx` is the
 * Vitest entry (jsdom). Every `api/mimic-layouts` call and the chrome's `fetchSystemStatus` are
 * stubbed: an unstubbed read reaches a local API on `:4000`.
 */

function user(role: AuthUser["role"]): AuthUser {
  return { id: "u1", email: "a@bms.local", displayName: "A", role } as unknown as AuthUser;
}

const LAYOUT_ID = "11111111-1111-4111-8111-111111111111";

const LIST: MimicLayoutsListResponse = {
  items: [
    {
      id: LAYOUT_ID,
      organizationId: "22222222-2222-4222-8222-222222222222",
      name: "Spec plant",
      slug: "spec-plant",
      canvasW: 126,
      canvasH: 68,
      version: 3,
      unitCount: 9,
      symbolLibraries: ["core"],
      updatedAt: new Date(0).toISOString(),
    },
  ],
};

const IN_USE = "2 dashboard widget(s) still use this layout";

function renderPage(
  as: AuthUser,
  listed: MimicLayoutsListResponse = LIST,
): { list: ReturnType<typeof vi.spyOn>; remove: ReturnType<typeof vi.spyOn> } {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  const list = vi.spyOn(api, "fetchMimicLayouts").mockResolvedValue(listed);
  const remove = vi
    .spyOn(api, "deleteMimicLayout")
    .mockRejectedValue(new ApiError(JSON.stringify({ message: IN_USE, error: "Conflict", statusCode: 409 }), 409));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/mimic-layouts"]}>
        <MimicLayoutsPage user={as} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { list, remove };
}

async function row(): Promise<HTMLElement> {
  const cell = await screen.findByText("Spec plant");
  const tr = cell.closest("tr");
  if (!tr) throw new Error("no row");
  return tr;
}

/** L1 — one row per layout, with its unit count. */
export async function listsEachLayoutWithItsUnitCount(): Promise<void> {
  renderPage(user("organization_admin"));
  expect(within(await row()).getByText("9")).toBeInTheDocument();
}

/** L2 — Open links to the editor route by id. */
export async function openLinksToTheEditor(): Promise<void> {
  renderPage(user("admin"));
  const link = within(await row()).getByRole("link", { name: "Open" });
  expect(link).toHaveAttribute("href", `/admin/mimic-layouts/${LAYOUT_ID}`);
}

/** L3a — "Start from" lists the seven presets by label, in enum order (ADR 0082 decision 5). */
export async function startFromListsTheSevenPresets(): Promise<void> {
  renderPage(user("admin"));
  const select = await screen.findByRole("combobox", { name: "Start from" });
  expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual([
    "Water train",
    "Electrical distribution",
    "HVAC chiller plant",
    "IT power and cooling",
    "Compressed air",
    "Environment monitoring",
    "Facility services",
  ]);
}

/** L3b — "Start from" opens on Water train, and Start opens the new route with that preset. */
export async function startDefaultsToWaterTrain(): Promise<void> {
  renderPage(user("admin"));
  expect(await screen.findByRole("combobox", { name: "Start from" })).toHaveValue("water_train");
  expect(screen.getByRole("link", { name: "Start" })).toHaveAttribute("href", "/admin/mimic-layouts/new?preset=water_train");
}

/** L3c — choosing Compressed air points Start at that preset. */
export async function startFollowsTheChosenPreset(): Promise<void> {
  renderPage(user("admin"));
  await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Start from" }), "compressed_air");
  expect(screen.getByRole("link", { name: "Start" })).toHaveAttribute("href", "/admin/mimic-layouts/new?preset=compressed_air");
}

function preview(): HTMLElement {
  return screen.getByTestId("mimic-preset-preview");
}

/** L9 — `F3.32g`: before Start, the preview draws the default Water train starter. */
export async function previewDrawsTheDefaultPreset(): Promise<void> {
  renderPage(user("admin"));
  await screen.findByRole("combobox", { name: "Start from" });
  expect(preview()).toHaveAttribute("data-preset", "water_train");
  expect(within(preview()).getByRole("img", { name: /^Water train preview: / })).toBeInTheDocument();
  // The starter's 8 roled units plus the Discharge sink, as a passive unit.
  expect(within(preview()).getAllByTestId("mimic-node")).toHaveLength(9);
  expect(within(preview()).getByTestId("mimic-preset-preview-counts")).toHaveTextContent("9 units · 8 pipes");
  expect(within(preview()).getByTestId("mimic-preset-preview-libraries")).toHaveTextContent(/^Core$/);
}

/** L10 — `F3.32g`: the preview follows the select, and draws the chosen preset's library glyphs. */
export async function previewFollowsTheSelect(): Promise<void> {
  renderPage(user("admin"));
  await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Start from" }), "facility_services");
  expect(preview()).toHaveAttribute("data-preset", "facility_services");
  expect(within(preview()).getAllByTestId("mimic-node")).toHaveLength(5);
  expect(within(preview()).getByTestId("mimic-preset-preview-libraries")).toHaveTextContent(
    /^Core, Tabler Icons, Lucide, Material Design Icons$/,
  );
  const drawn = [...preview().querySelectorAll("[data-glyph]")].map((g) => g.getAttribute("data-glyph"));
  expect(drawn).toEqual(
    expect.arrayContaining(["mdi:meter-electric", "lucide:lightbulb", "tabler:elevator", "tabler:fire-hydrant", "lucide:cog"]),
  );
}

/** L11 — `F3.32g`: no preset's preview draws the unknown-symbol fallback. */
export async function noPresetPreviewDrawsTheFallback(): Promise<void> {
  renderPage(user("admin"));
  const select = await screen.findByRole("combobox", { name: "Start from" });
  for (const option of within(select).getAllByRole("option")) {
    const value = option.getAttribute("value") ?? "";
    await userEvent.selectOptions(select, value);
    expect(preview()).toHaveAttribute("data-preset", value);
    expect(preview().querySelectorAll("[data-glyph]").length, value).toBeGreaterThan(0);
    expect(preview().querySelectorAll('[data-glyph-fallback="true"]'), value).toHaveLength(0);
    // `F3.32h`: a preset on a lazy library draws skeletons until it loads; none may stay.
    await waitFor(() => expect(preview().querySelectorAll('[data-glyph-loading="true"]'), value).toHaveLength(0));
  }
}

/** L8 — an empty library names no one preset: it points at the Start from choice. */
export async function anEmptyLibraryPointsAtAnyPreset(): Promise<void> {
  renderPage(user("admin"), { items: [] });
  expect(await screen.findByText("No layouts yet. Start from a preset, or draw a new one.")).toBeInTheDocument();
}

/** L4 — New opens the blank new-layout route. */
export async function newLinksToTheNewRoute(): Promise<void> {
  renderPage(user("admin"));
  expect(await screen.findByRole("link", { name: "New layout" })).toHaveAttribute("href", "/admin/mimic-layouts/new");
}

/** L5 — Delete asks first; Confirm delete calls the API with the id. */
export async function confirmDeleteCallsTheApiWithTheId(): Promise<void> {
  const { remove } = renderPage(user("admin"));
  const tr = await row();
  await userEvent.click(within(tr).getByRole("button", { name: "Delete" }));
  await userEvent.click(within(tr).getByRole("button", { name: "Confirm delete" }));
  await waitFor(() => expect(remove).toHaveBeenCalledWith(LAYOUT_ID));
}

/** L6 — the server's 409 sentence is shown, unwrapped from the JSON envelope. */
export async function aRefusedDeleteShowsTheServersSentence(): Promise<void> {
  renderPage(user("admin"));
  const tr = await row();
  await userEvent.click(within(tr).getByRole("button", { name: "Delete" }));
  await userEvent.click(within(tr).getByRole("button", { name: "Confirm delete" }));
  expect((await screen.findByRole("alert")).textContent).toBe(IN_USE);
}

/** L7 — a location_admin gets the status line and no read. */
export async function failsClosedForALocationAdmin(): Promise<void> {
  const { list } = renderPage(user("location_admin"));
  expect(await screen.findByRole("status")).toHaveTextContent("Mimic layouts are drawn by");
  expect(list).not.toHaveBeenCalled();
}
