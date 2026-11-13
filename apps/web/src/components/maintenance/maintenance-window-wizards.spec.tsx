import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import { MAINTENANCE_WINDOW_MAX_MS, type MaintenanceWindowItem } from "@bms/shared/contracts";

import * as assetsApi from "../../api/admin/assets";
import * as locationsApi from "../../api/admin/locations";
import * as maintenanceApi from "../../api/maintenance";
import * as windowsApi from "../../api/maintenance-windows";
import * as rulesApi from "../../api/rules";
import * as workOrdersApi from "../../api/work-orders";
import * as feedModule from "../../lib/alarm-bar-feed";
import {
  isoOfLocalInput,
  localInputOf,
  MaintenanceWindowWizard,
  maintenanceWindowWizardEntry,
  type MaintenanceWindowDialog,
  WINDOW_CANNOT_BE_UNDONE,
  WINDOW_LENGTH_RULE,
} from "./maintenance-window-wizards";

/**
 * `F4.359` U15 (ADR 0131 decisions 2 and 16; plan ruling Q6; ADR 0099 Amendment 19) — the four
 * maintenance-window wizards on `WizardShell`. Each claim is one exported function;
 * `maintenance-window-wizards.test.tsx` is the Vitest entry point. The reads are spied.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ORG = "00000000-0000-4000-8000-0000000000a1";
const SITE = "00000000-0000-4000-8000-0000000000b1";
const ASSET = "00000000-0000-4000-8000-0000000000c1";
const RULE = "00000000-0000-4000-8000-0000000000d1";
const WINDOW_ID = "00000000-0000-4000-8000-0000000000e1";

export function windowItem(overrides: Partial<MaintenanceWindowItem> = {}): MaintenanceWindowItem {
  const now = Date.now();
  return {
    id: WINDOW_ID,
    organizationId: ORG,
    reason: "Pump overhaul",
    startsAt: new Date(now - HOUR).toISOString(),
    endsAt: new Date(now + HOUR).toISOString(),
    endedAt: null,
    state: "active",
    createdByName: "Admin",
    endedByName: null,
    workOrder: null,
    maintenanceSchedule: null,
    targets: [{ kind: "asset", id: ASSET, label: "Pump 1" }],
    assetIds: [ASSET],
    ...overrides,
  };
}

type Spies = { refreshNow: ReturnType<typeof vi.fn>; client: QueryClient; onClose: ReturnType<typeof vi.fn> };

/** The target and link reads every create wizard makes. */
export function spyReads(): void {
  vi.spyOn(assetsApi, "fetchAdminAssets").mockResolvedValue({
    items: [{ id: ASSET, code: "P-001", name: "Pump 1", locationId: SITE, organizationCode: "PHE" }],
  } as never);
  vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue({
    items: [{ id: SITE, name: "Lakwa plant", organizationId: ORG, organizationName: "PHE West Bengal", parentId: null }],
  } as never);
  vi.spyOn(rulesApi, "fetchRules").mockResolvedValue({ items: [{ id: RULE, code: "R1", name: "High pressure" }] } as never);
  vi.spyOn(workOrdersApi, "fetchWorkOrders").mockResolvedValue({ items: [] } as never);
  vi.spyOn(maintenanceApi, "fetchMaintenanceSchedules").mockResolvedValue({ items: [] } as never);
}

function renderWizard(dialog: MaintenanceWindowDialog): Spies {
  spyReads();
  // The wizard alone: no `AlarmBar` reads the feed, so a stub with the one method it calls is whole.
  const refreshNow = vi.fn();
  vi.spyOn(feedModule, "alarmBarFeed").mockReturnValue({ refreshNow } as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <MaintenanceWindowWizard dialog={dialog} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { refreshNow, client, onClose };
}

const currentStep = (): string => screen.getByRole("list", { name: "Steps" }).querySelector('[aria-current="step"]')?.textContent ?? "";

/** W1 — an end 8 days out cannot leave the Window step, and the alert names the 7-day rule. */
export async function anEightDayWindowCannotLeaveTheWindowStep(): Promise<void> {
  renderWizard({ kind: "create" });
  const dialog = screen.getByRole("dialog", { name: "Create maintenance window" });
  await userEvent.type(within(dialog).getByLabelText("Reason"), "Pump overhaul");
  fireEvent.change(within(dialog).getByLabelText("End"), { target: { value: localInputOf(new Date(Date.now() + 8 * DAY)) } });
  // The rule is shown beside the field before Next is pressed.
  expect(within(dialog).getByText(/At most 7 days after the start/)).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
  expect(currentStep()).toBe("1. Window");
  expect(within(dialog).getByRole("alert")).toHaveTextContent(WINDOW_LENGTH_RULE);
  expect(WINDOW_LENGTH_RULE).toContain(`${MAINTENANCE_WINDOW_MAX_MS / DAY} days`);
}

/** W2 — a valid create posts the exact body: "Now" sends no `startsAt`; the bar refreshes and the list is invalidated. */
export async function aValidCreatePostsTheExactBody(): Promise<void> {
  const created = vi.spyOn(windowsApi, "createMaintenanceWindow").mockResolvedValue(windowItem());
  const { refreshNow, client, onClose } = renderWizard({ kind: "create" });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const dialog = screen.getByRole("dialog", { name: "Create maintenance window" });
  const end = localInputOf(new Date(Date.now() + 2 * DAY));
  await userEvent.type(within(dialog).getByLabelText("Reason"), "Pump overhaul");
  expect(within(dialog).getByLabelText("Now")).toBeChecked();
  fireEvent.change(within(dialog).getByLabelText("End"), { target: { value: end } });
  await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
  expect(currentStep()).toBe("2. Targets");
  await userEvent.click(await within(dialog).findByLabelText("Pump 1 (P-001)"));
  await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
  expect(currentStep()).toBe("3. Link");
  await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
  expect(currentStep()).toBe("4. Review");
  expect(within(dialog).getByText(/Create a maintenance window in PHE West Bengal from now to/)).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(created.mock.calls[0]?.[0]).toStrictEqual({
    reason: "Pump overhaul",
    endsAt: isoOfLocalInput(end),
    targets: [{ kind: "asset", assetId: ASSET }],
  });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["maintenance-windows"] });
  expect(refreshNow).toHaveBeenCalledTimes(1);
}

/** W3 — the End wizard's Review shows the entry's summary and says it cannot be undone; it sends the reason. */
export async function theReviewShowsTheEntrysSummary(): Promise<void> {
  const ended = vi.spyOn(windowsApi, "endMaintenanceWindow").mockResolvedValue(windowItem({ state: "past" }));
  const window = windowItem();
  const { onClose } = renderWizard({ kind: "end", window });
  const dialog = screen.getByRole("dialog", { name: "End maintenance window" });
  await userEvent.type(within(dialog).getByLabelText("Reason (optional)"), "Done early");
  await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
  const summary = maintenanceWindowWizardEntry("maintenanceWindow.end").summary({
    body: { reason: "Done early" },
    params: { id: window.id },
    targetName: window.reason,
    organizationName: "",
  });
  expect(within(dialog).getByText(summary)).toBeInTheDocument();
  expect(within(dialog).getByText(WINDOW_CANNOT_BE_UNDONE)).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(ended).toHaveBeenCalledWith(window.id, { reason: "Done early" });
}

/** W4 — Extend refuses an end more than 7 days from now and sends only the new end when no reason is typed. */
export async function extendKeepsTheSevenDayRuleFromNow(): Promise<void> {
  const extended = vi.spyOn(windowsApi, "extendMaintenanceWindow").mockResolvedValue(windowItem());
  const window = windowItem();
  const { onClose } = renderWizard({ kind: "extend", window });
  const dialog = screen.getByRole("dialog", { name: "Extend maintenance window" });
  const field = within(dialog).getByLabelText("New end", { selector: "input" });
  fireEvent.change(field, { target: { value: localInputOf(new Date(Date.now() + 8 * DAY)) } });
  await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
  expect(currentStep()).toBe("1. New end");
  expect(within(dialog).getByRole("alert")).toHaveTextContent("at most 7 days from now");
  const end = localInputOf(new Date(Date.now() + 3 * DAY));
  fireEvent.change(field, { target: { value: end } });
  await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
  expect(currentStep()).toBe("2. Review");
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(extended).toHaveBeenCalledWith(window.id, { endsAt: isoOfLocalInput(end) });
}

/** W5 — Cancel names a future window, says it cannot be undone and posts to cancel. */
export async function cancelPostsToTheCancelRoute(): Promise<void> {
  const cancelled = vi.spyOn(windowsApi, "cancelMaintenanceWindow").mockResolvedValue(windowItem({ state: "past" }));
  const window = windowItem({ state: "future", startsAt: new Date(Date.now() + DAY).toISOString(), endsAt: new Date(Date.now() + 2 * DAY).toISOString() });
  const { onClose } = renderWizard({ kind: "cancel", window });
  const dialog = screen.getByRole("dialog", { name: "Cancel maintenance window" });
  await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
  expect(within(dialog).getByText(/Cancel the maintenance window "Pump overhaul" that starts at/)).toBeInTheDocument();
  expect(within(dialog).getByText(WINDOW_CANNOT_BE_UNDONE)).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(cancelled).toHaveBeenCalledWith(window.id, {});
}
