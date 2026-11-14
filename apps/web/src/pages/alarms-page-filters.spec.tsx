import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { expect, vi, type MockInstance } from "vitest";

import type { AlarmListItem, AlarmSeverityDto, VocabulariesResponse } from "@bms/shared";

import * as alarmsApi from "../api/alarms";
import * as copilotApi from "../api/copilot";
import * as filterOptionsApi from "../api/filter-options";
import * as vocabApi from "../api/vocabularies";
import { IDS, OPTIONS } from "../lib/scope-filter.spec";
import type { AuthUser } from "../stores/auth-store";
import { AlarmsPage } from "./alarms-page";

/**
 * `F4.361` U7 (ADR 0132 decisions 1, 3, 7, 8 and 9; plan D13, D15) — the Alarm Centre's scope,
 * Severity and State filters. The request handed to `fetchAlarmsPage` and the URL (read by a probe
 * inside the router) are the observable places. A separate file from `alarms-page.spec.tsx`, which
 * sits near the §4.5 cap. `alarms-page-filters.test.tsx` is the Vitest entry point.
 */

const user = { id: "u1", email: "admin@bms.local", displayName: "Admin", role: "admin" } as unknown as AuthUser;

vi.mock("socket.io-client", () => ({
  io: () => ({ on: () => undefined, disconnect: () => undefined }),
}));

const SEVERITIES: AlarmSeverityDto[] = [
  { code: "info", label: "Info", tone: "info", rank: 10, active: true },
  { code: "critical", label: "Critical", tone: "critical", rank: 30, active: true },
];

const VOCABULARIES = { alarmSeverities: SEVERITIES } as unknown as VocabulariesResponse;

function alarm(id: string, severity: string, message: string): AlarmListItem {
  return {
    id,
    assetId: "as0",
    ruleKey: null,
    ruleId: "r0",
    severity,
    message,
    raisedAt: "2026-11-14T09:00:00.000Z",
    acknowledgedAt: null,
    acknowledgedBy: null,
    clearedAt: null,
    assetCode: "GEN-01",
    assetRtuName: "RTU 1",
    assetLocationName: "Plant A",
    assetName: "Generator One",
    siteName: "Plant A",
    source: "rule",
    rtuId: null,
    rtuCode: null,
    severityRank: severity === "critical" ? 30 : 10,
    suppressed: false,
    maintenanceWindowId: null,
    unsuppressedAt: null,
    locationName: null,
  };
}

const CRITICAL = alarm("c1", "critical", "Voltage above limit");
const INFO = alarm("i1", "info", "Humidity above limit");

/** The URL as text, and a Back button that is the browser's (`navigate(-1)`). */
function UrlProbe() {
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="url">{useLocation().search}</output>
      <button type="button" onClick={() => navigate(-1)}>
        probe back
      </button>
    </>
  );
}

function url(): URLSearchParams {
  return new URLSearchParams(screen.getByTestId("url").textContent ?? "");
}

type ListSpy = MockInstance<typeof alarmsApi.fetchAlarmsPage>;

/** The list answers by the severity asked for, so the cards' counts follow the request. */
function stubList(): ListSpy {
  return vi.spyOn(alarmsApi, "fetchAlarmsPage").mockImplementation(async (_cursor, _limit, query) => ({
    items: [CRITICAL, INFO].filter((a) => !query?.severity || a.severity === query.severity),
    nextCursor: null,
  }));
}

function renderAt(entry: string, options: Promise<typeof OPTIONS> = Promise.resolve(OPTIONS)): ListSpy {
  const list = stubList();
  vi.spyOn(filterOptionsApi, "fetchFilterOptions").mockReturnValue(options);
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue(VOCABULARIES);
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <AlarmsPage user={user} />
        <UrlProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return list;
}

function picker(name: string): HTMLSelectElement {
  return screen.getByRole("combobox", { name }) as HTMLSelectElement;
}

function lastQuery(list: ListSpy) {
  return list.mock.calls.at(-1)?.[2];
}

function criticalCard(): HTMLElement {
  const table = screen.getByRole("table");
  const label = screen.getAllByText("Critical").find((node) => !table.contains(node) && node.tagName !== "OPTION");
  if (!label?.parentElement) throw new Error("no Critical card");
  return label.parentElement;
}

/** Choosing an organization reads the list again with it, and writes it into the URL. */
export async function anOrganizationRefetchesAndIsInTheUrl(): Promise<void> {
  const list = renderAt("/alarms");
  await screen.findByRole("table");
  await vi.waitFor(() => expect(picker("Organization").disabled).toBe(false));
  await userEvent.selectOptions(picker("Organization"), IDS.ORG_A);
  await vi.waitFor(() => expect(lastQuery(list)).toEqual({ organizationId: IDS.ORG_A }));
  expect(url().get("organizationId")).toBe(IDS.ORG_A);
}

/** State replaces the checkbox: Suppressed sends `state=suppressed`, Active `state=active`, All none. */
export async function theStateDropdownSendsTheState(): Promise<void> {
  const list = renderAt("/alarms");
  await screen.findByRole("table");
  expect(screen.queryByRole("checkbox", { name: "Suppressed only" })).toBeNull();
  expect(lastQuery(list)).toEqual({});
  await userEvent.selectOptions(picker("State"), "suppressed");
  await vi.waitFor(() => expect(lastQuery(list)).toEqual({ state: "suppressed" }));
  expect(url().get("state")).toBe("suppressed");
  await userEvent.selectOptions(picker("State"), "active");
  await vi.waitFor(() => expect(lastQuery(list)).toEqual({ state: "active" }));
  await userEvent.selectOptions(picker("State"), "");
  await vi.waitFor(() => expect(url().has("state")).toBe(false));
}

/** A severity is sent, the cards count only what it returned, and Critical never reads "all clear" (D15). */
export async function aSeverityFiltersTheListAndTheCards(): Promise<void> {
  const list = renderAt("/alarms");
  await screen.findByRole("table");
  await vi.waitFor(() => expect(criticalCard().textContent).toContain("1"));
  await userEvent.selectOptions(picker("Severity"), "info");
  await vi.waitFor(() => expect(lastQuery(list)).toEqual({ severity: "info" }));
  await vi.waitFor(() => expect(within(screen.getByRole("table")).queryByText("Voltage above limit")).toBeNull());
  expect(criticalCard().textContent).toContain("0");
  expect(criticalCard().textContent).not.toContain("all clear");
  expect(url().get("severity")).toBe("info");
}

/** A link carrying all six keys is the first request, unchanged — no unfiltered read first (D13). */
export async function aSixKeyUrlIsTheFirstRead(): Promise<void> {
  const six = new URLSearchParams({
    organizationId: IDS.ORG_A,
    locationId: IDS.SITE_A,
    assetGroupId: IDS.G_A1,
    assetId: IDS.AS_A1,
    severity: "critical",
    state: "active",
  });
  const list = renderAt(`/alarms?${six}`);
  await screen.findByRole("table");
  expect(list.mock.calls[0][2]).toEqual({
    organizationId: IDS.ORG_A,
    locationId: IDS.SITE_A,
    assetGroupId: IDS.G_A1,
    assetId: IDS.AS_A1,
    severity: "critical",
    state: "active",
  });
  expect(picker("Asset").value).toBe(IDS.AS_A1);
}

/** With a scope in the URL the list waits for the options, then reads once with the cleaned filter. */
export async function theListWaitsForTheOptions(): Promise<void> {
  let resolve: (value: typeof OPTIONS) => void = () => undefined;
  const options = new Promise<typeof OPTIONS>((r) => {
    resolve = r;
  });
  const list = renderAt(`/alarms?organizationId=${IDS.ORG_A}&locationId=${IDS.SITE_X}`, options);
  await screen.findByText("Loading alarms…");
  expect(list).not.toHaveBeenCalled();
  resolve(OPTIONS);
  await screen.findByRole("table");
  expect(list.mock.calls.map((call) => call[2])).toEqual([{ organizationId: IDS.ORG_A }]);
  await vi.waitFor(() => expect(url().has("locationId")).toBe(false));
}

/** A State choice pushes a history entry, so Back takes `state` off the URL again (decision 8). */
export async function backUndoesAStateChoice(): Promise<void> {
  const list = renderAt("/alarms");
  await screen.findByRole("table");
  await userEvent.selectOptions(picker("State"), "suppressed");
  await vi.waitFor(() => expect(url().get("state")).toBe("suppressed"));
  await userEvent.click(screen.getByRole("button", { name: "probe back" }));
  await vi.waitFor(() => expect(url().has("state")).toBe(false));
  expect(picker("State").value).toBe("");
  await vi.waitFor(() => expect(lastQuery(list)).toEqual({}));
}

/** A filtered empty list says so, rather than telling the operator to start the simulator. */
export async function aFilteredEmptyListSaysSo(): Promise<void> {
  renderAt("/alarms?severity=nope");
  await screen.findByText("No alarms match the current filters.");
  expect(screen.queryByText(/Start the simulator/)).toBeNull();
}
