import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { AdminRtuDto, DeviceHealthResponse, RtuHealthDto, UserRole } from "@bms/shared";

import * as copilotApi from "../../api/copilot";
import * as deviceHealthApi from "../../api/device-health";
import * as locationsApi from "../../api/admin/locations";
import * as organizationsApi from "../../api/admin/organizations";
import * as rtusApi from "../../api/admin/rtus";
import * as systemStatusApi from "../../api/system-status";
import { OPERATIONAL } from "../../components/system-status-indicator.spec";
import type { AuthUser } from "../../stores/auth-store";
import { RtusAdminPage } from "./rtus-page";

/**
 * `F3.16` / ADR 0127 decisions 4, 16, 17, 18 and 20 — the RTUs page's device
 * health: Last seen, State, Clock skew, Drops 24 h, the edge marker, the
 * header tiles, the ingest-host banner and the global-admin-only unregistered
 * devices. Assertions live here; `rtus-page.health.test.tsx` is the Vitest
 * entry point and carries the jsdom docblock (ADR 0014, ADR 0042 decision 2).
 *
 * Every read is stubbed, so no request leaves the test process.
 */

const LOCATION_ID = "11111111-1111-4111-8111-111111111111";

function asUser(role: UserRole): AuthUser {
  return { id: "u1", email: `${role}@bms.local`, displayName: role, role } as unknown as AuthUser;
}

function rtu(id: string, code: string, sourceType = "mqtt"): AdminRtuDto {
  return {
    id,
    locationId: LOCATION_ID,
    locationName: "Spec site",
    organizationCode: "SPEC",
    code,
    displayName: `Gateway ${code}`,
    sourceType,
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
    tls: sourceType === "mqtt" ? true : null,
    payloadFormat: null,
  } as AdminRtuDto;
}

const ID_ONLINE = "a0000000-0000-4000-8000-000000000001";
const ID_STALE = "a0000000-0000-4000-8000-000000000002";
const ID_OFFLINE = "a0000000-0000-4000-8000-000000000003";
const ID_SIM = "a0000000-0000-4000-8000-000000000004";

const RTUS = [
  rtu(ID_ONLINE, "HL-ONLINE"),
  rtu(ID_STALE, "HL-STALE"),
  rtu(ID_OFFLINE, "HL-OFFLINE"),
  rtu(ID_SIM, "HL-SIM", "simulator"),
];

const MARKUP_SOURCE_KEY = "<b>x</b>";

function health(overrides: Partial<RtuHealthDto> & Pick<RtuHealthDto, "rtuId" | "state">): RtuHealthDto {
  return {
    lastSeenAt: null,
    windowSeconds: 25,
    clockSkewSeconds: null,
    clockSkewAt: null,
    edgeServed: false,
    drops24h: [],
    ...overrides,
  };
}

function body(hostState: "ok" | "stale" | "never" = "ok"): DeviceHealthResponse {
  const now = Date.now();
  return {
    ingestHost: { state: hostState, lastBeatAt: new Date(now - 5_000).toISOString() },
    items: [
      health({
        rtuId: ID_ONLINE,
        state: "online",
        lastSeenAt: new Date(now - 12_000).toISOString(),
        clockSkewSeconds: 300,
        drops24h: [
          {
            reason: "unmappedSourceKey",
            count: 5,
            firstAt: "2026-11-11T08:00:00.000Z",
            first: { assetId: null, assetCode: null, assetRtuName: null, assetLocationName: null, pointKey: null, sourceKey: MARKUP_SOURCE_KEY },
          },
          { reason: "badQuality", count: 2, firstAt: "2026-11-11T06:00:00.000Z", first: null },
        ],
      }),
      health({
        rtuId: ID_STALE,
        state: "stale",
        lastSeenAt: new Date(now - 5 * 60_000).toISOString(),
        clockSkewSeconds: -301,
        drops24h: [
          {
            reason: "outOfRange",
            count: 3,
            firstAt: "2026-11-11T08:00:00.000Z",
            first: { assetId: "x", assetCode: "AHU-1", assetRtuName: null, assetLocationName: null, pointKey: "supply_temp", sourceKey: "t1" },
          },
        ],
      }),
      health({ rtuId: ID_OFFLINE, state: "offline", edgeServed: true }),
      health({ rtuId: ID_SIM, state: "not_monitored" }),
    ],
    unattributed: [
      {
        hostKey: "ingest-1",
        endpointKey: "phe-broker",
        reason: "unknownDevice",
        count: 9,
        firstDeviceKey: "dev-<i>9</i>",
        firstSourceKey: "temp",
      },
    ],
  };
}

function stub(response: DeviceHealthResponse | Error): void {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  vi.spyOn(organizationsApi, "fetchAdminOrganizations").mockResolvedValue({ items: [] } as never);
  vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue({ items: [] } as never);
  vi.spyOn(locationsApi, "fetchAdminLocationSummary").mockResolvedValue({} as never);
  vi.spyOn(rtusApi, "fetchAdminRtus").mockResolvedValue({ items: RTUS } as never);
  if (response instanceof Error) {
    vi.spyOn(deviceHealthApi, "fetchDeviceHealth").mockRejectedValue(response);
  } else {
    vi.spyOn(deviceHealthApi, "fetchDeviceHealth").mockResolvedValue(response);
  }
  vi.spyOn(deviceHealthApi, "fetchRtuDropHistory").mockResolvedValue({
    items: [
      {
        bucket: "2026-11-10T08:00:00.000Z",
        reason: "unmappedSourceKey",
        count: 5,
        first: { assetId: null, assetCode: null, assetRtuName: null, assetLocationName: null, pointKey: null, sourceKey: "s-hist" },
      },
    ],
  });
}

function renderPage(response: DeviceHealthResponse | Error, role: UserRole = "admin"): void {
  stub(response);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/rtus"]}>
        <RtusAdminPage user={asUser(role)} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function rowOf(code: string): Promise<HTMLElement> {
  const row = (await screen.findByText(code)).closest("tr");
  if (!row) throw new Error(`no row for ${code}`);
  return row;
}

/** Waits until the health read has merged into the rows. */
async function healthLoaded(): Promise<void> {
  await within(await rowOf("HL-SIM")).findByText("Not monitored");
}

/** H1 — the State column says exactly Online / Stale / Offline / Not monitored. */
export async function eachStateRendersItsExactLabel(): Promise<void> {
  renderPage(body());
  await healthLoaded();
  for (const [code, label] of [
    ["HL-ONLINE", "Online"],
    ["HL-STALE", "Stale"],
    ["HL-OFFLINE", "Offline"],
    ["HL-SIM", "Not monitored"],
  ] as const) {
    expect(within(await rowOf(code)).getByText(label)).toBeInTheDocument();
  }
  for (const name of ["Last seen", "State", "Clock skew", "Drops 24 h"]) {
    expect(screen.getByRole("columnheader", { name })).toBeInTheDocument();
  }
}

/** H2 — Last seen is relative, with the absolute instant as its title; "Never" with no sample. */
export async function lastSeenIsRelativeWithAnAbsoluteTitle(): Promise<void> {
  renderPage(body());
  await healthLoaded();
  const online = within(await rowOf("HL-ONLINE")).getByText("12 s ago");
  expect(online.getAttribute("title")).toBeTruthy();
  expect(within(await rowOf("HL-STALE")).getByText("5 min ago")).toBeInTheDocument();
  expect(within(await rowOf("HL-OFFLINE")).getByText("Never")).toBeInTheDocument();
}

/** H3 — skew beyond ±300 s is highlighted; exactly 300 s is not. */
export async function skewIsHighlightedBeyondThreeHundredSecondsOnly(): Promise<void> {
  renderPage(body());
  await healthLoaded();
  const atLimit = within(await rowOf("HL-ONLINE")).getByText("+300 s");
  expect(atLimit.getAttribute("title")).toBeNull();
  expect(atLimit.className).not.toContain("text-warning-ink");
  const beyond = within(await rowOf("HL-STALE")).getByText("-301 s");
  expect(beyond.getAttribute("title")).toBe("Clock skew beyond ±300 s");
  expect(beyond.className).toContain("text-warning-ink");
}

/** H4 — a source key with markup renders as literal text, never as HTML; the point is named. */
export async function aMarkupSourceKeyRendersAsText(): Promise<void> {
  renderPage(body());
  await healthLoaded();
  const row = await rowOf("HL-ONLINE");
  expect(within(row).getByText(MARKUP_SOURCE_KEY, { exact: false })).toBeInTheDocument();
  expect(row.querySelector("b")).toBeNull();
  expect(within(row).getByRole("button", { name: "Drop history for HL-ONLINE" }).textContent).toBe("7");
  expect(within(await rowOf("HL-STALE")).getByText("AHU-1 · supply_temp", { exact: false })).toBeInTheDocument();
}

/** H5 — a simulator RTU reads "Not monitored" and shows no last-seen, skew or drops. */
export async function aSimulatorRtuReadsNotMonitored(): Promise<void> {
  renderPage(body());
  await healthLoaded();
  const row = await rowOf("HL-SIM");
  expect(within(row).getByText("Not monitored")).toBeInTheDocument();
  expect(within(row).queryByText("Never")).toBeNull();
  expect(within(row).queryByRole("button", { name: /Drop history/ })).toBeNull();
}

/** H6 — an edge-served RTU carries the Edge marker; a cloud-served one does not. */
export async function anEdgeServedRtuCarriesTheMarker(): Promise<void> {
  renderPage(body());
  await healthLoaded();
  expect(within(await rowOf("HL-OFFLINE")).getByText("Edge")).toBeInTheDocument();
  expect(within(await rowOf("HL-ONLINE")).queryByText("Edge")).toBeNull();
}

function tileValue(label: string): string {
  const card = screen.getByText(label, { selector: "span" }).parentElement?.parentElement;
  if (!card) throw new Error(`no tile ${label}`);
  return card.querySelector("p")?.textContent ?? "";
}

/** H7 — the header tiles count monitored RTUs only. */
export async function theHeaderTilesCountMonitoredRtus(): Promise<void> {
  renderPage(body());
  await healthLoaded();
  const tiles = screen.getByRole("region", { name: "Device health" });
  expect(within(tiles).getByText("Monitored")).toBeInTheDocument();
  expect(tileValue("Monitored")).toBe("3");
  expect(within(tiles).getAllByText(/^(Online|Stale|Offline)$/)).toHaveLength(3);
  const values = ["Online", "Stale", "Offline"].map((label) => {
    const span = within(tiles).getByText(label, { selector: "span" });
    return span.parentElement?.parentElement?.querySelector("p")?.textContent;
  });
  expect(values).toEqual(["1", "1", "1"]);
}

/** H8 — the ingest-host banner shows when the host is not ok, and only then. */
export async function theBannerShowsOnlyWhenTheHostIsNotOk(): Promise<void> {
  renderPage(body("stale"));
  expect(
    await screen.findByText("Ingest host not reporting — device states are frozen at its last heartbeat."),
  ).toBeInTheDocument();
}

export async function noBannerWhileTheHostIsOk(): Promise<void> {
  renderPage(body("ok"));
  await healthLoaded();
  expect(screen.queryByText(/Ingest host not reporting/)).toBeNull();
}

/** H9 — the unregistered devices section is the global admin's only (decision 17), and its keys are text. */
export async function aGlobalAdminSeesUnregisteredDevices(): Promise<void> {
  renderPage(body(), "admin");
  const section = (await screen.findByText("Unregistered devices (24 h)")).closest("section");
  if (!section) throw new Error("no section");
  const scoped = within(section as HTMLElement);
  expect(await scoped.findByText("phe-broker")).toBeInTheDocument();
  expect(scoped.getByText("Unknown device")).toBeInTheDocument();
  expect(scoped.getByText("9")).toBeInTheDocument();
  expect(scoped.getByText("dev-<i>9</i>")).toBeInTheDocument();
  expect(section.querySelector("i")).toBeNull();
}

export async function anOrganizationAdminSeesNoUnregisteredDevices(): Promise<void> {
  renderPage(body(), "organization_admin");
  await healthLoaded();
  expect(screen.queryByText("Unregistered devices (24 h)")).toBeNull();
  expect(screen.queryByText("phe-broker")).toBeNull();
}

/** H10 — a failed health read leaves the RTU list rendered with "—" in the health cells. */
export async function theListSurvivesAFailedHealthRead(): Promise<void> {
  renderPage(new Error("device-health 500"));
  const row = await rowOf("HL-ONLINE");
  expect(within(row).getByText("Gateway HL-ONLINE")).toBeInTheDocument();
  expect(within(row).getAllByText("—").length).toBeGreaterThanOrEqual(4);
  expect(screen.queryByText(/Ingest host not reporting/)).toBeNull();
}

/** H11 — the Drops cell opens the 30-day history drawer for that RTU. */
export async function theDropsCellOpensTheHistoryDrawer(): Promise<void> {
  renderPage(body());
  await healthLoaded();
  await userEvent.click(
    within(await rowOf("HL-ONLINE")).getByRole("button", { name: "Drop history for HL-ONLINE" }),
  );
  const dialog = await screen.findByRole("dialog", { name: "Drop history — HL-ONLINE" });
  expect(await within(dialog).findByText("s-hist")).toBeInTheDocument();
  expect(vi.mocked(deviceHealthApi.fetchRtuDropHistory)).toHaveBeenCalledWith(ID_ONLINE);
}
