import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { WorkOrderListItem } from "@bms/shared";

import * as assetsApi from "../api/assets";
import * as workOrdersApi from "../api/work-orders";
import type { AuthUser } from "../stores/auth-store";
import { priorityRailStyle, priorityStyle, WorkOrdersPage } from "./work-orders-page";

/**
 * `F3.65b` owner ruling R-f (2026-09-28) — priority `high` and `medium` must not
 * look the same. The palette migration merged both onto the warning pill; the
 * ruling splits them again with existing roles only: `high` takes the solid
 * warning line and the strong wash, `medium` the soft line and the plain wash;
 * the kanban card's left rail is solid for `high` and half-opacity for `medium`.
 *
 * Assertions live here; `work-orders-page.test.tsx` is the Vitest entry point
 * (ADR 0014).
 */

export function highAndMediumPillsDiffer(): void {
  expect(priorityStyle("high")).not.toBe(priorityStyle("medium"));
}

export function highPillIsTheRuledStrongWarning(): void {
  expect(priorityStyle("high")).toBe("border-warning bg-warning-wash-strong text-warning-ink");
}

export function mediumPillIsTheRuledSoftWarning(): void {
  expect(priorityStyle("medium")).toBe("border-warning-line bg-warning-wash text-warning-ink");
}

export function highAndMediumRailsDiffer(): void {
  expect(priorityRailStyle("high")).not.toBe(priorityRailStyle("medium"));
}

export function mediumRailIsTheHalfOpacityWarning(): void {
  expect(priorityRailStyle("medium")).toBe("border-l-warning/50");
}

/**
 * `F4.204` — the `api/work-orders` writers throw an `Error` whose message is the
 * whole response body, so a refusal read through `err.message` showed
 * `{"statusCode":409,…}` on the page. Each of the four write sites reads it
 * through `apiErrorMessage`; one case per site, because a site left on the raw
 * read reddens only its own case. Each case refuses with its own sentence, and
 * finds the error element by that sentence — never by an element that renders
 * before the refusal.
 */

/**
 * The page's `AppShell` opens a Socket.IO connection on mount; a unit test has
 * no business dialling one (the `alarms-page.spec.tsx` precedent).
 */
vi.mock("socket.io-client", () => ({
  io: () => ({
    on: () => undefined,
    off: () => undefined,
    emit: () => undefined,
    disconnect: () => undefined,
  }),
}));

const user: AuthUser = {
  id: "u1",
  email: "admin@bms.local",
  displayName: "Admin",
  role: "admin",
} as unknown as AuthUser;

const ROW: WorkOrderListItem = {
  id: "0f4e1d2c-0000-4000-8000-000000000001",
  assetId: "asset-1",
  alarmId: null,
  title: "Replace pump bearing",
  description: null,
  status: "open",
  priority: "medium",
  sortOrder: 0,
  assignedTo: null,
  createdBy: null,
  dueAt: null,
  resolvedAt: null,
  closedAt: null,
  createdAt: "2026-10-01T09:00:00.000Z",
  updatedAt: "2026-10-01T09:00:00.000Z",
  assetCode: "PMP-01",
  assetName: "Pump One",
  siteName: "Plant A",
};

const ASSET = {
  id: "asset-1",
  code: "PMP-01",
  name: "Pump One",
  siteName: "Plant A",
} as unknown as assetsApi.AssetRow;

function envelope(sentence: string): Error {
  return new Error(`{"statusCode":409,"message":"${sentence}","error":"Conflict"}`);
}

async function renderPage(): Promise<void> {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("work-orders-page.spec: no fetch expected"))),
  );
  vi.spyOn(workOrdersApi, "fetchWorkOrders").mockResolvedValue({ items: [ROW] });
  vi.spyOn(assetsApi, "fetchAssets").mockResolvedValue([ASSET]);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Seeded, not only stubbed. While the list query has no data, `rows` is a fresh `[]` on every
  // render and the page's `[rows]` effect sets a fresh `[]` into state, so each commit schedules
  // another render. Observed: without this seed the jsdom worker hangs before any case reports;
  // with it, every case runs.
  queryClient.setQueryData(["work-orders", "list"], { items: [ROW] });
  queryClient.setQueryData(["assets", "list"], [ASSET]);
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <WorkOrdersPage user={user} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByText(ROW.title);
}

/** The element carrying the refusal, found by its sentence; it must not carry the JSON. */
async function expectTheSentenceNotTheEnvelope(sentence: string): Promise<void> {
  const element = await screen.findByText(new RegExp(sentence));
  expect(element.textContent).toContain(sentence);
  expect(element.textContent).not.toContain('{"');
}

const CREATE_SENTENCE = "An open work order already exists for this alarm";
const STATUS_SENTENCE = "A closed work order cannot change status";
const CLOSE_SENTENCE = "This work order was already closed by another user";
const REORDER_SENTENCE = "The board changed while you were dragging";

/** A refused work-order create shows the server sentence, not the JSON envelope. */
export async function aRefusedCreateShowsTheSentence(): Promise<void> {
  vi.spyOn(workOrdersApi, "createWorkOrder").mockRejectedValue(envelope(CREATE_SENTENCE));
  await renderPage();
  await screen.findByRole("option", { name: "PMP-01 · Pump One" });

  await userEvent.click(screen.getByRole("button", { name: "+ New WO" }));
  const dialog = await screen.findByRole("dialog", { name: "Create work order" });
  await userEvent.type(within(dialog).getByLabelText("Title"), "Check pump");
  await userEvent.click(within(dialog).getByRole("button", { name: "Create" }));

  await expectTheSentenceNotTheEnvelope(CREATE_SENTENCE);
}

/** A refused status change shows the server sentence, not the JSON envelope. */
export async function aRefusedStatusChangeShowsTheSentence(): Promise<void> {
  vi.spyOn(workOrdersApi, "updateWorkOrderStatus").mockRejectedValue(envelope(STATUS_SENTENCE));
  await renderPage();

  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  const dialog = await screen.findByRole("dialog", { name: "Edit status" });
  await userEvent.selectOptions(within(dialog).getByLabelText("New status"), "assigned");
  await userEvent.click(within(dialog).getByRole("button", { name: "Save status" }));

  await expectTheSentenceNotTheEnvelope(STATUS_SENTENCE);
}

/** A refused close shows the server sentence, not the JSON envelope. */
export async function aRefusedCloseShowsTheSentence(): Promise<void> {
  vi.spyOn(workOrdersApi, "closeWorkOrder").mockRejectedValue(envelope(CLOSE_SENTENCE));
  await renderPage();

  await userEvent.click(screen.getByRole("button", { name: "Close" }));
  const dialog = await screen.findByRole("dialog", { name: "Close work order" });
  await userEvent.type(within(dialog).getByLabelText("Closure reason"), "Bearing replaced");
  await userEvent.click(within(dialog).getByRole("button", { name: "Close work order" }));

  await expectTheSentenceNotTheEnvelope(CLOSE_SENTENCE);
}

/** A refused board reorder shows the server sentence, not the JSON envelope. */
export async function aRefusedReorderShowsTheSentence(): Promise<void> {
  const reorder = vi
    .spyOn(workOrdersApi, "reorderWorkOrders")
    .mockRejectedValue(envelope(REORDER_SENTENCE));
  await renderPage();

  const card = screen.getByText(ROW.title).closest("article");
  if (!card) {
    throw new Error("the work-order card has no <article> around its title");
  }
  // The first empty column is Assigned: the Open column holds the one row.
  const assignedColumn = screen.getAllByText("Drop work orders here")[0];
  const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
  fireEvent.dragStart(card, { dataTransfer });
  fireEvent.dragOver(assignedColumn, { dataTransfer });
  fireEvent.drop(assignedColumn, { dataTransfer });

  await expectTheSentenceNotTheEnvelope(REORDER_SENTENCE);
  // The adjacent positive: the drop reached the reorder writer, not the close dialog.
  expect(reorder).toHaveBeenCalledTimes(1);
}
