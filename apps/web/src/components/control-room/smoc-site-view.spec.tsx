import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi, type Mock } from "vitest";

import type { AccessibleScope } from "@bms/shared";

import { SMOC_TABS, smocTabPath, type SmocTabKey } from "../../lib/smoc-pages";
import { CR_POINT_KEYS, CR_TRACKED_ASSET_CODES } from "../live-svg/control-room-bindings";
import { SmocSiteView } from "./smoc-site-view";

/**
 * `F3.70` U4 — `SmocSiteView`, the `builtin/smoc` body of the site page
 * (ADR 0076 decision 9; plan D1, D4, D9; OQ1, OQ2), cases T1–T7.
 *
 * Assertions live here; `smoc-site-view.test.tsx` is the Vitest entry point
 * and carries the `@vitest-environment jsdom` docblock (ADR 0014, ADR 0042
 * decision 2).
 *
 * The telemetry provider is a passthrough that records its props, and each of
 * the seven contents is a marker `div`: this suite asserts which content the
 * view mounts and under which provider, not what the content renders. `fetch`
 * is a spy, and `cleanupView` fails the case if anything reached it.
 */
const state = vi.hoisted(() => ({
  providers: [] as Array<{ assetCodes: readonly string[]; pointKeys: readonly string[] | undefined }>,
}));

vi.mock("../live-svg/schematic-telemetry-context", () => ({
  SchematicTelemetryProvider: ({
    assetCodes,
    pointKeys,
    children,
  }: {
    assetCodes: readonly string[];
    pointKeys?: readonly string[];
    children: ReactNode;
  }) => {
    state.providers.push({ assetCodes, pointKeys });
    return <div data-testid="telemetry-provider">{children}</div>;
  },
}));

vi.mock("./smoc/overview", () => ({
  ControlRoomOverviewContent: () => <div data-testid="tab-overview" />,
}));
vi.mock("./smoc/sld", () => ({
  ControlRoomSldContent: () => <div data-testid="tab-sld" />,
}));
vi.mock("./smoc/ups", () => ({
  ControlRoomUpsContent: () => <div data-testid="tab-ups" />,
}));
vi.mock("./smoc/battery", () => ({
  ControlRoomBatteryContent: () => <div data-testid="tab-battery" />,
}));
vi.mock("./smoc/hvac", () => ({
  ControlRoomHvacContent: () => <div data-testid="tab-hvac" />,
}));
vi.mock("./smoc/env", () => ({
  ControlRoomEnvContent: () => <div data-testid="tab-env" />,
}));
vi.mock("./smoc/it", () => ({
  ControlRoomItContent: () => <div data-testid="tab-it" />,
}));

const LOCATION_ID = "loc-smoc";

const GLOBAL: AccessibleScope = { kind: "global", locations: [], assetGroups: [], assetIds: [] };

const HVAC_ONLY: AccessibleScope = {
  kind: "asset_group",
  locations: [],
  assetGroups: [
    {
      id: "66666666-6666-4666-8666-666666666666",
      locationId: "22222222-2222-4222-8222-222222222222",
      code: "hvac",
      name: "HVAC",
      organizationId: "77777777-7777-4777-8777-777777777777",
    },
  ],
  assetIds: [],
};

const SCOPED_OUT = "Outside your asset-group scope";

let fetchSpy: Mock | null = null;

function renderView(tab: SmocTabKey, scope: AccessibleScope | null = GLOBAL): void {
  fetchSpy = vi.fn(() => Promise.reject(new Error("a spec reached the network")));
  vi.stubGlobal("fetch", fetchSpy);
  render(
    <MemoryRouter initialEntries={[smocTabPath(LOCATION_ID, tab)]}>
      <SmocSiteView locationId={LOCATION_ID} tab={tab} scope={scope} />
    </MemoryRouter>,
  );
}

function stripLinks(): HTMLAnchorElement[] {
  const nav = screen.getByRole("navigation", { name: "SMOC pages" });
  return within(nav).getAllByRole("link") as HTMLAnchorElement[];
}

/** T1 — a global scope: seven links, in `SMOC_TABS` order, each to its absolute tab path. */
export function theStripListsTheSevenTabsInOrder(): void {
  renderView("overview");

  const links = stripLinks().map((a) => [a.textContent, a.getAttribute("href")]);
  expect(links).toEqual(SMOC_TABS.map((tab) => [tab.label, smocTabPath(LOCATION_ID, tab.key)]));
}

/** T2 — exactly one link carries `aria-current="page"`, and it is the active tab. */
export function theActiveTabIsTheOnlyCurrentLink(): void {
  renderView("hvac");

  const current = stripLinks().filter((a) => a.getAttribute("aria-current") === "page");
  expect(current.map((a) => a.getAttribute("href"))).toEqual([smocTabPath(LOCATION_ID, "hvac")]);
}

/** T3a — the chosen tab's content mounts. */
export function theChosenContentMounts(): void {
  renderView("sld");

  expect(screen.getByTestId("tab-sld")).toBeInTheDocument();
}

/** T3b — no other tab's content mounts (after T3a's positive control). */
export function noOtherContentMounts(): void {
  renderView("sld");

  expect(screen.getByTestId("tab-sld")).toBeInTheDocument();
  const others = SMOC_TABS.filter((tab) => tab.key !== "sld").filter(
    (tab) => screen.queryByTestId(`tab-${tab.key}`) !== null,
  );
  expect(others.map((tab) => tab.key)).toEqual([]);
}

/** T4 — an HVAC-only scope: the strip holds overview and hvac, nothing else. */
export function anHvacOnlyScopeShowsTwoTabs(): void {
  renderView("overview", HVAC_ONLY);

  expect(stripLinks().map((a) => a.getAttribute("href"))).toEqual([
    smocTabPath(LOCATION_ID, "overview"),
    smocTabPath(LOCATION_ID, "hvac"),
  ]);
}

/** T5a — a tab outside the per-area rule shows the scoped-out card (OQ2, D4). */
export function aDisallowedTabShowsTheScopedOutCard(): void {
  renderView("sld", HVAC_ONLY);

  const heading = screen.getByRole("heading", { name: SCOPED_OUT });
  expect(heading.closest("section")).not.toBeNull();
}

/** T5b — a tab outside the per-area rule mounts no content (after T5a's positive control). */
export function aDisallowedTabMountsNoContent(): void {
  renderView("sld", HVAC_ONLY);

  expect(screen.getByRole("heading", { name: SCOPED_OUT })).toBeInTheDocument();
  expect(screen.queryByTestId("tab-sld")).toBeNull();
}

/** T6 — a tab outside the per-area rule keeps the allowed strip above the card. */
export function aDisallowedTabKeepsTheStrip(): void {
  renderView("sld", HVAC_ONLY);

  expect(screen.getByRole("heading", { name: SCOPED_OUT })).toBeInTheDocument();
  expect(stripLinks().map((a) => a.getAttribute("href"))).toEqual([
    smocTabPath(LOCATION_ID, "overview"),
    smocTabPath(LOCATION_ID, "hvac"),
  ]);
}

/** T7a — one provider wraps the content, with the CR asset codes and point keys. */
export function theProviderTakesTheCrConstants(): void {
  renderView("ups");

  expect(within(screen.getByTestId("telemetry-provider")).getByTestId("tab-ups")).toBeInTheDocument();
  expect(state.providers).toEqual([{ assetCodes: CR_TRACKED_ASSET_CODES, pointKeys: CR_POINT_KEYS }]);
}

/** T7b — a tab outside the per-area rule mounts no provider (after T5a's positive control). */
export function aDisallowedTabMountsNoProvider(): void {
  renderView("sld", HVAC_ONLY);

  expect(screen.getByRole("heading", { name: SCOPED_OUT })).toBeInTheDocument();
  expect(screen.queryByTestId("telemetry-provider")).toBeNull();
  expect(state.providers).toEqual([]);
}

export function cleanupView(): void {
  cleanup();
  const networkCalls = fetchSpy?.mock.calls.map((call) => String(call[0])) ?? [];
  fetchSpy = null;
  state.providers.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  expect(networkCalls, "a read reached the network").toEqual([]);
}
