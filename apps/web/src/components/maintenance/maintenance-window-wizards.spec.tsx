import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
import { isoOfLocalInput, localInputOf, localMinuteOf, localZoneLabel } from "../../lib/maintenance-window-time";
import { useWizardStore } from "../../stores/wizard-store";
import {
  MaintenanceWindowWizard,
  maintenanceWindowWizardEntry,
  type MaintenanceWindowDialog,
  WINDOW_CANNOT_BE_UNDONE,
  WINDOW_LENGTH_RULE,
} from "./maintenance-window-wizards";

/**
 * `F4.359` U15 (ADR 0131 decisions 2 and 16; plan ruling Q6; ADR 0099 Amendment 19) — the four
 * maintenance-window wizards on `WizardShell`. Each claim is one exported function;
 * `maintenance-window-wizards.test.tsx` is the Vitest entry point and pins `TZ=Asia/Kolkata`, so a
 * time read or shown in UTC instead of the browser's zone fails. The reads are spied.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ORG = "00000000-0000-4000-8000-0000000000a1";
const SITE = "00000000-0000-4000-8000-0000000000b1";
const ASSET = "00000000-0000-4000-8000-0000000000c1";
const RULE = "00000000-0000-4000-8000-0000000000d1";
const WINDOW_ID = "00000000-0000-4000-8000-0000000000e1";
const ORG_B = "00000000-0000-4000-8000-0000000000a2";
const SITE_B = "00000000-0000-4000-8000-0000000000b2";
const ASSET_B = "00000000-0000-4000-8000-0000000000c2";
const FOREIGN = "00000000-0000-4000-8000-0000000000ff";

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

export function renderWizard(dialog: MaintenanceWindowDialog, reads: () => void = () => undefined): Spies {
  spyReads();
  reads();
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

/** The browser zone's label, as the wizards print it (Asia/Kolkata under the test wrapper). */
const zone = (): string => localZoneLabel();
const endField = (dialog: HTMLElement): HTMLElement => within(dialog).getByLabelText(`End (${zone()})`);
const next = async (dialog: HTMLElement): Promise<void> => userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
/** A whole minute `ms` from now, as a `datetime-local` value. */
const inputIn = (ms: number): string => localInputOf(new Date(Date.now() + ms));

const currentStep = (): string => screen.getByRole("list", { name: "Steps" }).querySelector('[aria-current="step"]')?.textContent ?? "";

/** W1 — an end 8 days out cannot leave the Window step, and the alert names the 7-day rule. */
export async function anEightDayWindowCannotLeaveTheWindowStep(): Promise<void> {
  renderWizard({ kind: "create" });
  const dialog = screen.getByRole("dialog", { name: "Create maintenance window" });
  await userEvent.type(within(dialog).getByLabelText("Reason"), "Pump overhaul");
  fireEvent.change(endField(dialog), { target: { value: localInputOf(new Date(Date.now() + 8 * DAY)) } });
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
  fireEvent.change(endField(dialog), { target: { value: end } });
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
    // `F4.362` leftover 3: the end names its window's targets, on the page as on the card.
    maintenanceWindow: {
      reason: window.reason,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      targetLabels: ["Pump 1"],
      locationLabels: [],
      coveredAssetCount: 1,
    },
  });
  expect(summary).toContain('"Pump overhaul" (Pump 1) now');
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
  const field = within(dialog).getByLabelText(`New end (${zone()})`, { selector: "input" });
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
  expect(within(dialog).getByText(/Cancel the maintenance window "Pump overhaul" \(Pump 1\) that starts at/)).toBeInTheDocument();
  expect(within(dialog).getByText(WINDOW_CANNOT_BE_UNDONE)).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(cancelled).toHaveBeenCalledWith(window.id, {});
}

/** W6 — "At a time" posts its `startsAt`, read in the browser's zone; the inputs and the Review name the zone. */
export async function aTimedCreatePostsItsStart(): Promise<void> {
  expect(zone()).toBe("UTC+05:30");
  const created = vi.spyOn(windowsApi, "createMaintenanceWindow").mockResolvedValue(windowItem());
  const { onClose } = renderWizard({ kind: "create" });
  const dialog = screen.getByRole("dialog", { name: "Create maintenance window" });
  const start = inputIn(2 * HOUR);
  const end = inputIn(5 * HOUR);
  await userEvent.type(within(dialog).getByLabelText("Reason"), "Pump overhaul");
  await userEvent.click(within(dialog).getByLabelText("At a time"));
  fireEvent.change(within(dialog).getByLabelText(`Start time (${zone()})`), { target: { value: start } });
  fireEvent.change(endField(dialog), { target: { value: end } });
  await next(dialog);
  await userEvent.click(await within(dialog).findByLabelText("Pump 1 (P-001)"));
  await next(dialog);
  await next(dialog);
  expect(currentStep()).toBe("4. Review");
  const startsAt = isoOfLocalInput(start) as string;
  // `F4.360`: the Review's rows say both times in the browser's zone, labelled.
  const rows = within(dialog).getByRole("table").textContent ?? "";
  expect(rows).toContain(`Start${localMinuteOf(startsAt)} (${zone()})`);
  expect(rows).toContain(`End${localMinuteOf(isoOfLocalInput(end) as string)} (${zone()})`);
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  // The start typed in IST is that wall-clock minute's instant, not the same digits in UTC.
  const [date, time] = start.split("T") as [string, string];
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [h, mi] = time.split(":").map(Number) as [number, number];
  expect(startsAt).toBe(new Date(y, m - 1, d, h, mi).toISOString());
  expect(created.mock.calls[0]?.[0]).toStrictEqual({
    reason: "Pump overhaul",
    startsAt,
    endsAt: isoOfLocalInput(end),
    targets: [{ kind: "asset", assetId: ASSET }],
  });
}

/** W7 — an end at or before the start keeps the Window step, with its sentence. */
export async function anEndBeforeTheStartStaysOnTheWindowStep(): Promise<void> {
  renderWizard({ kind: "create" });
  const dialog = screen.getByRole("dialog", { name: "Create maintenance window" });
  await userEvent.type(within(dialog).getByLabelText("Reason"), "Pump overhaul");
  await userEvent.click(within(dialog).getByLabelText("At a time"));
  fireEvent.change(within(dialog).getByLabelText(`Start time (${zone()})`), { target: { value: inputIn(3 * HOUR) } });
  fireEvent.change(endField(dialog), { target: { value: inputIn(2 * HOUR) } });
  await next(dialog);
  expect(currentStep()).toBe("1. Window");
  expect(within(dialog).getByRole("alert")).toHaveTextContent("A maintenance window must end after its start.");
}

/** W8 — a start in the past keeps the Window step, with its sentence. */
export async function aStartInThePastIsRefused(): Promise<void> {
  renderWizard({ kind: "create" });
  const dialog = screen.getByRole("dialog", { name: "Create maintenance window" });
  await userEvent.type(within(dialog).getByLabelText("Reason"), "Pump overhaul");
  await userEvent.click(within(dialog).getByLabelText("At a time"));
  fireEvent.change(within(dialog).getByLabelText(`Start time (${zone()})`), { target: { value: inputIn(-2 * HOUR) } });
  fireEvent.change(endField(dialog), { target: { value: inputIn(2 * HOUR) } });
  await next(dialog);
  expect(currentStep()).toBe("1. Window");
  expect(within(dialog).getByRole("alert")).toHaveTextContent("A maintenance window cannot start in the past.");
}

/** W9 — Extend shows the current end in the browser's zone, labelled, not in UTC. */
export async function extendShowsTheCurrentEndInLocalTime(): Promise<void> {
  const window = windowItem({ endsAt: "2026-11-13T08:00:00.000Z" });
  renderWizard({ kind: "extend", window });
  const dialog = screen.getByRole("dialog", { name: "Extend maintenance window" });
  expect(within(dialog).getByText("Now ends 2026-11-13 13:30 (UTC+05:30).")).toBeInTheDocument();
}

/**
 * W10 — a Copilot fill naming a target, a work order and a schedule the caller's lists do not hold
 * shows each as "(not in your list)" — in the Chosen line, the selects and the Review — never as
 * "None" or a bare id the user cannot read.
 */
export async function aFilledIdOutsideTheListsIsNamedAsSuch(): Promise<void> {
  renderWizard({ kind: "create" });
  const dialog = screen.getByRole("dialog", { name: "Create maintenance window" });
  const fill = (stepId: string, values: Record<string, unknown>) =>
    act(() => {
      useWizardStore.getState().receiveFill({ catalogId: "maintenanceWindow.create", params: {}, stepId, values }, null);
    });
  await fill("window", { reason: "Pump overhaul", endsAt: new Date(Date.now() + DAY).toISOString() });
  await fill("targets", { targets: [{ kind: "asset", assetId: FOREIGN }] });
  await fill("link", { workOrderId: FOREIGN, maintenanceScheduleId: FOREIGN });
  await next(dialog);
  expect(currentStep()).toBe("2. Targets");
  await waitFor(() => expect(within(dialog).getByText(`Chosen: ${FOREIGN} (not in your list)`)).toBeInTheDocument());
  await next(dialog);
  expect(currentStep()).toBe("3. Link");
  const workOrder = within(dialog).getByLabelText("Work order") as HTMLSelectElement;
  const schedule = within(dialog).getByLabelText("Maintenance schedule") as HTMLSelectElement;
  expect(workOrder.selectedOptions[0]?.textContent).toBe(`${FOREIGN} (not in your list)`);
  expect(workOrder.selectedOptions[0]?.disabled).toBe(true);
  expect(schedule.selectedOptions[0]?.textContent).toBe(`${FOREIGN} (not in your list)`);
  await next(dialog);
  expect(currentStep()).toBe("4. Review");
  const rows = within(dialog).getByRole("table").textContent ?? "";
  expect(rows).toContain(`Work order${FOREIGN} (not in your list)`);
  expect(rows).toContain(`Maintenance schedule${FOREIGN} (not in your list)`);
  expect(within(dialog).getByText(new RegExp(`on 1 target: ${FOREIGN} \\(not in your list\\)`))).toBeInTheDocument();
}

/** The reads of a caller who reads two organizations, each with a site named "Lakwa plant". */
function twoOrganizations(): void {
  vi.spyOn(assetsApi, "fetchAdminAssets").mockResolvedValue({
    items: [
      { id: ASSET, code: "P-001", name: "Pump 1", locationId: SITE, organizationCode: "PHE" },
      { id: ASSET_B, code: "P-002", name: "Pump 2", locationId: SITE_B, organizationCode: "PHA" },
    ],
  } as never);
  vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue({
    items: [
      { id: SITE, name: "Lakwa plant", organizationId: ORG, organizationName: "PHE West Bengal", parentId: null },
      { id: SITE_B, name: "Lakwa plant", organizationId: ORG_B, organizationName: "PHE Assam", parentId: null },
    ],
  } as never);
}

/** W11 — targets of two organizations cannot leave the Targets step; same-named sites carry their organization. */
export async function targetsOfTwoOrganizationsAreRefused(): Promise<void> {
  renderWizard({ kind: "create" }, twoOrganizations);
  const dialog = screen.getByRole("dialog", { name: "Create maintenance window" });
  await userEvent.type(within(dialog).getByLabelText("Reason"), "Pump overhaul");
  fireEvent.change(endField(dialog), { target: { value: inputIn(DAY) } });
  await next(dialog);
  await userEvent.click(await within(dialog).findByLabelText("Lakwa plant (PHE West Bengal)"));
  await userEvent.click(within(dialog).getByLabelText("Pump 2 (P-002)"));
  await next(dialog);
  expect(currentStep()).toBe("2. Targets");
  expect(within(dialog).getByRole("alert")).toHaveTextContent(
    "Every target of a maintenance window must belong to one organization: PHE West Bengal and PHE Assam are both chosen.",
  );
  // One organization's targets pass.
  await userEvent.click(within(dialog).getByLabelText("Pump 2 (P-002)"));
  await userEvent.click(within(dialog).getByLabelText("Pump 1 (P-001)"));
  await next(dialog);
  expect(currentStep()).toBe("3. Link");
}

/** The headers of one request, whatever shape `init.headers` took. */
const headersOf = (init: RequestInit | undefined): Headers => new Headers(init?.headers);

/**
 * W12 — each of the four wizards sends the plain request: no `X-Copilot-Change` header (a copilot
 * write goes through the dock's card only). The global `fetch` is stubbed, not the API wrapper,
 * because the header is only observable on the request; the positive is that each write fired.
 */
export async function theFourWritesSendNoCopilotHeader(): Promise<void> {
  const seen: { url: string; init: RequestInit | undefined }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    seen.push({ url, init });
    return new Response(JSON.stringify(windowItem()), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  const submitted = async (title: string): Promise<void> => {
    const dialog = screen.getByRole("dialog", { name: title });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Submit" })).toBeInTheDocument());
    await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  };

  let spies = renderWizard({ kind: "create" });
  let dialog = screen.getByRole("dialog", { name: "Create maintenance window" });
  await userEvent.type(within(dialog).getByLabelText("Reason"), "Pump overhaul");
  fireEvent.change(endField(dialog), { target: { value: inputIn(DAY) } });
  await next(dialog);
  await userEvent.click(await within(dialog).findByLabelText("Pump 1 (P-001)"));
  await next(dialog);
  await next(dialog);
  await submitted("Create maintenance window");
  await waitFor(() => expect(spies.onClose).toHaveBeenCalledTimes(1));
  cleanup();

  spies = renderWizard({ kind: "extend", window: windowItem() });
  dialog = screen.getByRole("dialog", { name: "Extend maintenance window" });
  fireEvent.change(within(dialog).getByLabelText(`New end (${zone()})`, { selector: "input" }), { target: { value: inputIn(2 * DAY) } });
  await next(dialog);
  await submitted("Extend maintenance window");
  await waitFor(() => expect(spies.onClose).toHaveBeenCalledTimes(1));
  cleanup();

  for (const [kind, title] of [
    ["end", "End maintenance window"],
    ["cancel", "Cancel maintenance window"],
  ] as const) {
    spies = renderWizard({ kind, window: windowItem() });
    await next(screen.getByRole("dialog", { name: title }));
    await submitted(title);
    await waitFor(() => expect(spies.onClose).toHaveBeenCalledTimes(1));
    cleanup();
  }

  const writes = seen.filter(({ init }) => init?.method === "POST");
  expect(writes.map(({ url }) => url.replace(/^.*\/api\/v1/, ""))).toEqual([
    "/maintenance-windows",
    `/maintenance-windows/${WINDOW_ID}/extend`,
    `/maintenance-windows/${WINDOW_ID}/end`,
    `/maintenance-windows/${WINDOW_ID}/cancel`,
  ]);
  for (const { init } of writes) expect(headersOf(init).has("X-Copilot-Change")).toBe(false);
}
