import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { AlarmListItem, AlarmSeverityDto, AssetRoleSummaryItem, SiteWidgetTab, SiteWidgetsResponse } from "@bms/shared";

import { ActiveAlarmsRailWidget } from "./active-alarms-rail-widget";
import { AssetClassStripWidget } from "./asset-class-strip-widget";
import { CriticalSystemsListWidget } from "./critical-systems-list-widget";
import { ModuleSummaryCardWidget } from "./module-summary-card-widget";
import { siteTabHref, type SiteTabHref } from "./site-widget-parts";
import { StateLegendWidget } from "./state-legend-widget";

/**
 * `F3.73` (plan Task 3.5) — the five site widgets, presentation only. Each renders from a fixture
 * response; nothing here reads. `StateLegend` reads the severity vocabulary through a module mock
 * (an unmocked fetch would reach the real API on :4000), and the router is a `MemoryRouter`.
 *
 * Every absence sits beside a positive control in the same fixture, so a missing string is a
 * decision about the widget rather than a render that produced nothing.
 */

vi.mock("../../api/vocabularies", () => ({
  vocabulariesQueryKey: ["vocabularies"],
  fetchVocabularies: () => Promise.resolve({ alarmSeverities: [] }),
}));

const SEVERITIES: AlarmSeverityDto[] = [
  { code: "warning", label: "Warning", tone: "warning", rank: 20, active: true },
  { code: "critical", label: "Critical", tone: "critical", rank: 40, active: true },
];

const SITE_PATH = "/control-room/site/loc-1";
const SITE_TAB_HREF: SiteTabHref = (tabKey) => siteTabHref(SITE_PATH, tabKey);

function alarm(id: string, assetCode: string, message: string): AlarmListItem {
  return {
    id,
    assetId: `asset-${id}`,
    ruleKey: null,
    ruleId: null,
    severity: "critical",
    message,
    raisedAt: "2026-09-30T10:15:00.000Z",
    acknowledgedAt: null,
    acknowledgedBy: null,
    clearedAt: null,
    assetCode,
    assetName: assetCode,
    siteName: "Site",
  };
}

const ROLE: AssetRoleSummaryItem = {
  code: "ups",
  label: "UPS",
  count: 4,
  worstSeverity: { code: "critical", label: "Critical", tone: "critical", rank: 40 },
  worstCount: 2,
  offlineCount: 1,
};

function tab(tabKey: string, label: string, status: SiteWidgetTab["status"]): SiteWidgetTab {
  return { tabKey, label, assetGroupId: "22222222-2222-4222-8222-222222222222", status };
}

const UPS_TAB = tab("ups", "UPS Monitoring", {
  worstSeverity: "critical",
  tone: "critical",
  activeAlarms: 3,
  offlineAssets: 1,
  assets: 6,
});
const HVAC_TAB = tab("hvac", "HVAC System", {
  worstSeverity: null,
  tone: "ok",
  activeAlarms: 0,
  offlineAssets: 0,
  assets: 9,
});
const HIDDEN_TAB = tab("env", "Environment", null);

function response(overrides: Partial<SiteWidgetsResponse> = {}): SiteWidgetsResponse {
  return {
    dashboardId: "11111111-1111-4111-8111-111111111111",
    tabKey: null,
    resolvedAt: "2026-09-30T10:20:00.000Z",
    scope: { assetCount: 15 },
    alarms: {
      active: [alarm("a1", "UPS-01", "Bypass open"), alarm("a2", "UPS-02", "Fan failure"), alarm("a3", "HVAC-01", "High temp")],
      summary: [
        { code: "warning", label: "Warning", tone: "warning", rank: 20, count: 2 },
        { code: "critical", label: "Critical", tone: "critical", rank: 40, count: 3 },
      ],
    },
    roles: [ROLE],
    tabs: [UPS_TAB, HVAC_TAB, HIDDEN_TAB],
    ...overrides,
  };
}

function wrap(ui: ReactElement): ReactElement {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

export function cleanupWidgets(): void {
  cleanup();
}

const COMMON = { title: "Widget", status: "ready" as const, severities: SEVERITIES };

// ---------------------------------------------------------------------------------- rail

export function theRailListsTheActiveAlarmsOfItsTab(): void {
  render(wrap(<ActiveAlarmsRailWidget {...COMMON} data={response()} config={{ rows: 8, showSummary: true }} />));
  expect(screen.getByText("UPS-01")).toBeInTheDocument();
  expect(screen.getByText("Bypass open")).toBeInTheDocument();
  expect(screen.getByText("HVAC-01")).toBeInTheDocument();
}

/** `rows` caps the list: two rows of three alarms, with the third absent beside the two present. */
/**
 * Critique finding: a frame title "ACTIVE ALARMS" sat over an inner "Active Alarms" tab. The
 * doubled heading goes; a title that adds information (a renamed widget) and the non-ready
 * placeholder, which has no tab strip, both keep theirs.
 */
export function theRailDoesNotRepeatItsTabAsAHeading(): void {
  render(wrap(<ActiveAlarmsRailWidget {...COMMON} title="Active alarms" data={response()} config={{ rows: 8, showSummary: true }} />));
  expect(screen.getByRole("tab", { name: "Active Alarms" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: /active alarms/i })).toBeNull();
}

export function aRenamedRailKeepsItsHeadingAndALoadingRailKeepsItsTitle(): void {
  render(wrap(<ActiveAlarmsRailWidget {...COMMON} title="Plant alarms" data={response()} config={{ rows: 8, showSummary: true }} />));
  expect(screen.getByRole("heading", { name: "Plant alarms" })).toBeInTheDocument();
  cleanup();
  render(wrap(<ActiveAlarmsRailWidget {...COMMON} title="Active alarms" status="loading" data={undefined} config={{ rows: 8, showSummary: true }} />));
  expect(screen.getByRole("heading", { name: "Active alarms" })).toBeInTheDocument();
  expect(screen.getByText("Loading…")).toBeInTheDocument();
}

export function theRailDrawsAtMostItsConfiguredRows(): void {
  render(wrap(<ActiveAlarmsRailWidget {...COMMON} data={response()} config={{ rows: 2, showSummary: true }} />));
  expect(screen.getByText("UPS-01")).toBeInTheDocument();
  expect(screen.getByText("UPS-02")).toBeInTheDocument();
  expect(screen.queryByText("HVAC-01")).toBeNull();
}

/** The summary tab totals the per-severity counts (2 + 3) and lists the most urgent first. */
export async function theRailSummaryTabShowsTheTotal(): Promise<void> {
  render(wrap(<ActiveAlarmsRailWidget {...COMMON} data={response()} config={{ rows: 8, showSummary: true }} />));
  await userEvent.click(screen.getByRole("tab", { name: "Alarm Summary" }));
  expect(screen.getByTestId("alarm-summary-total").textContent).toBe("5");
  const items = within(screen.getByRole("list", { name: "Active alarms by severity" })).getAllByRole("listitem");
  expect(items.map((item) => item.textContent)).toEqual(["Critical3", "Warning2"]);
}

export function theRailHidesTheSummaryTabWhenConfiguredOff(): void {
  render(wrap(<ActiveAlarmsRailWidget {...COMMON} data={response()} config={{ rows: 8, showSummary: false }} />));
  expect(screen.getByRole("tab", { name: "Active Alarms" })).toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: "Alarm Summary" })).toBeNull();
}

/** Turning the summary off while it is the selected tab falls back to the alarms, not a blank panel. */
export async function aRailOnTheSummaryTabFallsBackWhenTheSummaryIsTurnedOff(): Promise<void> {
  const widget = (showSummary: boolean) =>
    wrap(<ActiveAlarmsRailWidget {...COMMON} data={response()} config={{ rows: 8, showSummary }} />);
  const { rerender } = render(widget(true));
  await userEvent.click(screen.getByRole("tab", { name: "Alarm Summary" }));
  expect(screen.queryByText("UPS-01")).toBeNull();
  rerender(widget(false));
  expect(screen.getByText("UPS-01")).toBeInTheDocument();
}

export function theRailSaysSoWhenNoAlarmIsActive(): void {
  render(
    wrap(
      <ActiveAlarmsRailWidget
        {...COMMON}
        data={response({ alarms: { active: [], summary: [] } })}
        config={{ rows: 8, showSummary: true }}
      />,
    ),
  );
  expect(screen.getByText("No active alarms")).toBeInTheDocument();
}

// ---------------------------------------------------------------------------------- legend, strip

export async function theLegendNamesNormalAndOffline(): Promise<void> {
  render(wrap(<StateLegendWidget title="Legend" status="ready" />));
  expect(await screen.findByText("Normal")).toBeInTheDocument();
  expect(screen.getByText("Offline")).toBeInTheDocument();
}

/**
 * `F3.77` plan D2 — the legend is one 64 px row: no `WidgetFrame`, whose chrome (`p-3`, the `h3`,
 * `mb-2`) takes about 48.5 px. The title is still drawn, inline: the adjacent positive.
 * Mutation: wrap the body in `WidgetFrame` again → the heading is back → red.
 */
export async function theLegendDrawsNoHeadingButItsTitleInline(): Promise<void> {
  render(wrap(<StateLegendWidget title="Legend" status="ready" />));
  await screen.findByText("Normal");
  expect(screen.getByText("Legend")).toBeInTheDocument();
  expect(screen.queryByRole("heading")).not.toBeInTheDocument();
}

/** `F3.77` plan D2 — the title and the pills share one clipped row that fills its cell. */
export async function theLegendTitleAndPillsShareOneRow(): Promise<void> {
  render(wrap(<StateLegendWidget title="Legend" status="ready" />));
  await screen.findByText("Normal");
  const row = screen.getByText("Legend").parentElement;
  expect(row).not.toBeNull();
  expect(screen.getByLabelText("State legend").parentElement?.parentElement).toBe(row);
  for (const name of ["flex", "h-full", "items-center", "overflow-hidden", "surface-raised"]) {
    expect(row, `the legend row lacks ${name}`).toHaveClass(name);
  }
}

/**
 * `F3.77` review — a long title gives way to the pills, not the other way round. The title is
 * `varchar(255)`; with `shrink-0` it kept its full width, `truncate` never applied, and the row's
 * `overflow-hidden` clipped the trailing pills (Offline first). jsdom has no layout, so this pins
 * the flex contract that decides it: the title may shrink (`min-w-0`, no `shrink-0`) and
 * truncates; the pills' wrapper may not shrink, so the pills stay on one line at full width.
 * Mutation: put `shrink-0` back on the title → red.
 */
export async function aLongLegendTitleTruncatesAndKeepsThePills(): Promise<void> {
  const long = "Severity and connection state legend - north campus";
  render(wrap(<StateLegendWidget title={long} status="ready" />));
  await screen.findByText("Normal");
  const title = screen.getByText(long);
  const row = title.parentElement;
  expect(within(row as HTMLElement).getByText("Offline")).toBeInTheDocument();
  expect(title).toHaveClass("min-w-0", "truncate");
  expect(title).not.toHaveClass("shrink-0");
  const pills = screen.getByLabelText("State legend").parentElement;
  expect(pills?.parentElement).toBe(row);
  expect(pills).toHaveClass("shrink-0");
}

export function theStripDrawsOnePillPerRole(): void {
  render(wrap(<AssetClassStripWidget title="Classes" status="ready" data={response()} />));
  expect(screen.getByText("UPS 4 · 2 Critical · 1 Offline")).toBeInTheDocument();
}

export function theStripSaysSoWhenNoRoleIsInScope(): void {
  render(wrap(<AssetClassStripWidget title="Classes" status="ready" data={response({ roles: [] })} />));
  expect(screen.getByText("No asset classes in scope")).toBeInTheDocument();
}

// ---------------------------------------------------------------------------------- module card

function card(data: SiteWidgetsResponse, targetTabKey: string, tabHref: SiteTabHref | null = SITE_TAB_HREF): void {
  render(wrap(<ModuleSummaryCardWidget {...COMMON} data={data} config={{ targetTabKey }} tabHref={tabHref} />));
}

export function theCardShowsItsTabsStatusAndCounts(): void {
  card(response(), "ups");
  expect(screen.getByText("Critical")).toBeInTheDocument();
  expect(screen.getByText("3 alarms · 1 offline · 6 assets")).toBeInTheDocument();
}

/**
 * The link names the tab the CONFIG chose. Two configs, two targets: a card that hardcoded
 * `overview` — or the first tab — would give one of them the wrong href.
 */
export function theCardLinksToItsTargetTab(): void {
  card(response(), "ups");
  expect(screen.getByRole("link", { name: "Open UPS Monitoring" }).getAttribute("href")).toBe(`${SITE_PATH}/ups`);
  cleanup();
  card(response(), "hvac");
  expect(screen.getByRole("link", { name: "Open HVAC System" }).getAttribute("href")).toBe(`${SITE_PATH}/hvac`);
}

/** A card off the site page has no site path, so it draws its numbers and no link. */
export function theCardDrawsNoLinkOffTheSitePage(): void {
  card(response(), "ups", null);
  expect(screen.getByText("3 alarms · 1 offline · 6 assets")).toBeInTheDocument();
  expect(screen.queryByRole("link")).toBeNull();
}

/** A healthy tab reads "Normal" — not a blank pill — beside the critical one above. */
export function aCardOnAHealthyTabReadsNormal(): void {
  card(response(), "hvac");
  expect(screen.getByText("Normal")).toBeInTheDocument();
  expect(screen.getByText("0 alarms · 0 offline · 9 assets")).toBeInTheDocument();
}

/**
 * Critique: "NORMAL · 3 offline". A tab with offline members and no active alarm reads "Offline"
 * in the server's tone, never "Normal"; the healthy HVAC card beside it still reads "Normal".
 */
const OFFLINE_TAB = tab("water", "Water", {
  worstSeverity: null,
  tone: "warning",
  activeAlarms: 0,
  offlineAssets: 3,
  assets: 5,
});

export function aCardOnATabWithOfflineMembersNeverReadsNormal(): void {
  card(response({ tabs: [OFFLINE_TAB, HVAC_TAB] }), "water");
  expect(screen.getByText("Offline")).toBeInTheDocument();
  expect(screen.queryByText("Normal")).toBeNull();
  cleanup();
  card(response({ tabs: [OFFLINE_TAB, HVAC_TAB] }), "hvac");
  expect(screen.getByText("Normal")).toBeInTheDocument();
}

/** The pill carries the read's tone: the offline card's pill is drawn in the warning palette. */
export function anOfflineCardsPillCarriesTheWarningTone(): void {
  card(response({ tabs: [OFFLINE_TAB] }), "water");
  expect(screen.getByText("Offline").className).toMatch(/warning/);
}

/**
 * The server raises an `info` tab with an offline member to `warning` (`tabTone`), so the label
 * names that cause: "Offline", never an amber "Info". An `info` tab with no offline member keeps
 * its severity's label — the positive control beside it.
 */
const INFO_SEVERITIES: AlarmSeverityDto[] = [
  ...SEVERITIES,
  { code: "info", label: "Info", tone: "info", rank: 10, active: true },
];

function infoTab(offlineAssets: number): SiteWidgetTab {
  return tab("water", "Water", {
    worstSeverity: "info",
    tone: offlineAssets > 0 ? "warning" : "info",
    activeAlarms: 1,
    offlineAssets,
    assets: 5,
  });
}

function infoCard(offlineAssets: number): void {
  render(
    wrap(
      <ModuleSummaryCardWidget
        {...COMMON}
        severities={INFO_SEVERITIES}
        data={response({ tabs: [infoTab(offlineAssets)] })}
        config={{ targetTabKey: "water" }}
        tabHref={SITE_TAB_HREF}
      />,
    ),
  );
}

export function anInfoAlarmBesideAnOfflineMemberReadsOffline(): void {
  infoCard(1);
  expect(screen.getByText("Offline")).toBeInTheDocument();
  expect(screen.queryByText("Info")).toBeNull();
}

export function anInfoAlarmWithNoOfflineMemberReadsItsLabel(): void {
  infoCard(0);
  expect(screen.getByText("Info")).toBeInTheDocument();
  expect(screen.queryByText("Offline")).toBeNull();
}

/**
 * A severity the vocabulary does not list yet (still loading) keeps its code as the label beside
 * an offline member: it may be `critical`, so the pill never claims the member set the tone.
 */
export function anUnlistedSeverityBesideAnOfflineMemberKeepsItsCode(): void {
  render(
    wrap(
      <ModuleSummaryCardWidget
        {...COMMON}
        severities={[]}
        data={response({ tabs: [UPS_TAB] })}
        config={{ targetTabKey: "ups" }}
        tabHref={SITE_TAB_HREF}
      />,
    ),
  );
  expect(screen.getByText("critical")).toBeInTheDocument();
  expect(screen.queryByText("Offline")).toBeNull();
}

/** A `warning` alarm beside an offline member keeps its label: the alarm, not the member, set the tone. */
export function aWarningAlarmBesideAnOfflineMemberReadsWarning(): void {
  card(response({ tabs: [ONE_TAB] }), "one");
  expect(screen.getByText("Warning")).toBeInTheDocument();
  expect(screen.queryByText("Offline")).toBeNull();
}

/** "1 alarm" and "1 asset", singular for exactly one (critique: "1 alarms", "1 assets"). */
const ONE_TAB = tab("one", "One", { worstSeverity: "warning", tone: "warning", activeAlarms: 1, offlineAssets: 1, assets: 1 });

export function theCountsSaySingularForOneAlarm(): void {
  card(response({ tabs: [ONE_TAB] }), "one");
  expect(screen.getByText(/^1 alarm · /)).toBeInTheDocument();
}

export function theCountsSaySingularForOneAsset(): void {
  card(response({ tabs: [ONE_TAB] }), "one");
  expect(screen.getByText(/ · 1 asset$/)).toBeInTheDocument();
}

/** A tab the caller cannot read says so — never a zero that would read as healthy. */
export function aCardOnAnUnreadableTabSaysOutsideScope(): void {
  card(response(), "env");
  expect(screen.getByText("Outside scope")).toBeInTheDocument();
  expect(screen.queryByText(/alarms ·/)).toBeNull();
}

/** A target the read does not list (a tab since deleted) also says so, and still links by key. */
export function aCardOnAnUnlistedTabSaysOutsideScope(): void {
  card(response(), "gone");
  expect(screen.getByText("Outside scope")).toBeInTheDocument();
}

// ---------------------------------------------------------------------------------- list

export function theListShowsOneRowPerGroupTab(): void {
  render(wrap(<CriticalSystemsListWidget {...COMMON} data={response()} tabHref={SITE_TAB_HREF} />));
  const rows = within(screen.getByRole("list", { name: "Critical systems" })).getAllByRole("listitem");
  expect(rows).toHaveLength(3);
  expect(within(rows[0]).getByText("3 alarms · 1 offline · 6 assets")).toBeInTheDocument();
  expect(within(rows[0]).getByText("Critical")).toBeInTheDocument();
  expect(within(rows[1]).getByText("Normal")).toBeInTheDocument();
}

/** A critical-systems row with offline members and no alarm reads "Offline"; the HVAC row beside it, "Normal". */
export function aListRowWithOfflineMembersNeverReadsNormal(): void {
  render(wrap(<CriticalSystemsListWidget {...COMMON} data={response({ tabs: [OFFLINE_TAB, HVAC_TAB] })} tabHref={SITE_TAB_HREF} />));
  const rows = within(screen.getByRole("list", { name: "Critical systems" })).getAllByRole("listitem");
  expect(within(rows[0]).getByText("Offline")).toBeInTheDocument();
  expect(within(rows[0]).queryByText("Normal")).toBeNull();
  expect(within(rows[1]).getByText("Normal")).toBeInTheDocument();
}

/** The positive control is the first two rows above; this one is the row with no status. */
export function theListShowsOutsideScopeForATabWithNoStatus(): void {
  render(wrap(<CriticalSystemsListWidget {...COMMON} data={response()} tabHref={SITE_TAB_HREF} />));
  const rows = within(screen.getByRole("list", { name: "Critical systems" })).getAllByRole("listitem");
  expect(within(rows[2]).getByText("Outside scope")).toBeInTheDocument();
  expect(within(rows[0]).queryByText("Outside scope")).toBeNull();
}

export function theListLinksEachRowToItsTab(): void {
  render(wrap(<CriticalSystemsListWidget {...COMMON} data={response()} tabHref={SITE_TAB_HREF} />));
  expect(screen.getByRole("link", { name: "UPS Monitoring" }).getAttribute("href")).toBe(`${SITE_PATH}/ups`);
  expect(screen.getByRole("link", { name: "HVAC System" }).getAttribute("href")).toBe(`${SITE_PATH}/hvac`);
}

export function theListSaysSoWhenTheDashboardHasNoGroupTab(): void {
  render(wrap(<CriticalSystemsListWidget {...COMMON} data={response({ tabs: [] })} tabHref={SITE_TAB_HREF} />));
  expect(screen.getByText("No system tabs")).toBeInTheDocument();
}

// ---------------------------------------------------------------------------------- frame

/** Not ready: the frame's placeholder replaces every body — the same rule as the other types. */
export function aLoadingSiteWidgetDrawsThePlaceholderNotItsBody(): void {
  render(wrap(<CriticalSystemsListWidget {...COMMON} status="loading" data={undefined} tabHref={SITE_TAB_HREF} />));
  expect(screen.getByText("Loading…")).toBeInTheDocument();
  expect(screen.queryByText("No system tabs")).toBeNull();
}

export function aFailedSiteWidgetDrawsTheErrorLine(): void {
  render(wrap(<ModuleSummaryCardWidget {...COMMON} status="error" data={undefined} config={{ targetTabKey: "ups" }} tabHref={SITE_TAB_HREF} />));
  expect(screen.getByText("Could not load widget.")).toBeInTheDocument();
  expect(screen.queryByText("Outside scope")).toBeNull();
}
