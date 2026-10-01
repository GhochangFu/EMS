import type { DashboardDto, DashboardWidgetDto, DashboardWidgetPointDto } from "@bms/shared";

import { duplicatePayload, freeSlug } from "./dashboard-duplicate";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function point(overrides: Partial<DashboardWidgetPointDto> = {}): DashboardWidgetPointDto {
  return {
    id: "point-row-1",
    pointId: "point-1",
    role: "primary",
    sortOrder: 0,
    assetId: "asset-1",
    assetCode: "ASSET-1",
    pointKey: "power_kw",
    unit: "kW",
    ...overrides,
  };
}

function widgetDto(overrides: Partial<DashboardWidgetDto> = {}): DashboardWidgetDto {
  return {
    id: "widget-1",
    dashboardId: "source-dash",
    organizationId: "org-1",
    title: "Feed pump power",
    gridX: 0,
    gridY: 0,
    gridW: 4,
    gridH: 4,
    points: [point()],
    // `F3.35` Stage C. Required by the DTO; the `as DashboardWidgetDto` cast below hides
    // an omission from the compiler, so a missing key surfaces as a TypeError at run time.
    sources: [],
    tabId: null,
    widgetType: "value_tile",
    config: { unit: "kW", decimals: 1 },
    ...overrides,
  } as DashboardWidgetDto;
}

function sourceDashboard(widgets: DashboardWidgetDto[], tabs: DashboardDto["tabs"] = []): DashboardDto {
  return {
    id: "source-dash",
    organizationId: "org-1",
    slug: "feed-pumps",
    name: "Feed pumps",
    description: "Original description",
    locationId: "loc-1",
    assetGroupId: null,
    assetId: null,
    assetTemplateId: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    templateId: null,
    tabs,
    widgets,
  };
}

const TAB_OVERVIEW = {
  id: "tab-overview-id",
  dashboardId: "source-dash",
  organizationId: "org-1",
  key: "overview",
  label: "Overview",
  sortOrder: 0,
  assetGroupId: null,
};
const TAB_UPS = {
  ...TAB_OVERVIEW,
  id: "tab-ups-id",
  key: "ups",
  label: "UPS",
  sortOrder: 1,
  assetGroupId: "group-ups",
};

function tabbedSource(): DashboardDto {
  return sourceDashboard(
    [
      widgetDto({ id: "w-tile-overview", tabId: TAB_OVERVIEW.id }),
      widgetDto({ id: "w-tile-ups", tabId: TAB_UPS.id }),
      widgetDto({
        id: "w-mimic-ups",
        tabId: TAB_UPS.id,
        widgetType: "mimic",
        points: [],
        config: { source: "preset", preset: "water_train" },
      } as Partial<DashboardWidgetDto>),
    ],
    [TAB_OVERVIEW, TAB_UPS],
  );
}

const sameLocation = { locationId: "loc-1", assetGroupId: null };
const otherLocation = { locationId: "loc-2", assetGroupId: null };
function targetAt(scope: { locationId: string | null; assetGroupId: string | null }) {
  return { organizationId: "org-1", scope, slug: "feed-pumps-copy", name: "Feed pumps (copy)" };
}

/** `F3.73` D11b — the copy carries the source tabs with their ids dropped. */
export function runDuplicateTabsCarriedTests(): void {
  const payload = duplicatePayload(tabbedSource(), targetAt(sameLocation));
  assert(payload.widgets.tabs.length === 2, "the copy carries both source tabs");
  for (const tab of payload.widgets.tabs) {
    assert(!("id" in tab), `a duplicated tab must not carry the source tab's id — found ${JSON.stringify(tab)}`);
  }
  assert(
    payload.widgets.tabs[1]!.key === "ups" && payload.widgets.tabs[1]!.label === "UPS",
    "the tab key and label are copied",
  );
  const byTitle = payload.widgets.widgets.map((widget) => widget.tabKey);
  assert(
    JSON.stringify(byTitle) === JSON.stringify(["overview", "ups", "ups"]),
    `each widget keeps its tabKey — got ${JSON.stringify(byTitle)}`,
  );
}

/** `F3.73` D11b — a same-location copy keeps the group bindings and every mimic. */
export function runDuplicateSameLocationKeepsGroupsTests(): void {
  const payload = duplicatePayload(tabbedSource(), targetAt(sameLocation));
  assert(
    payload.widgets.tabs[1]!.assetGroupId === "group-ups",
    "a same-location duplicate keeps the tab's group binding",
  );
  assert(payload.widgets.widgets.length === 3, "a same-location duplicate keeps the tab mimic");
  assert(payload.droppedMimics === 0, "nothing is dropped on a same-location duplicate");
}

/** `F3.73` D11b — a cross-location copy clears every tab group and drops the tab mimics. */
export function runDuplicateCrossLocationClearsGroupsTests(): void {
  const payload = duplicatePayload(tabbedSource(), targetAt(otherLocation));
  assert(
    payload.widgets.tabs.every((tab) => tab.assetGroupId === null),
    `a cross-location duplicate clears every tab's assetGroupId — got ${JSON.stringify(payload.widgets.tabs)}`,
  );
  assert(
    payload.widgets.tabs.length === 2,
    "the tabs stay as plain canvases",
  );
  assert(
    payload.widgets.widgets.length === 2 && payload.widgets.widgets.every((w) => w.widgetType !== "mimic"),
    "the mimic on the group-cleared tab is dropped",
  );
  assert(payload.droppedMimics === 1, `one dropped mimic is counted — got ${payload.droppedMimics}`);
}

/** `freeSlug` — the first candidate not already taken, bounded and length-safe. */
export function runFreeSlugTests(): void {
  assert(freeSlug("feed-pumps", []) === "feed-pumps-copy", "the first candidate is <base>-copy");

  // The load-bearing assertion (plan §9): a taken first candidate must be skipped, not reused.
  assert(
    freeSlug("feed-pumps", ["feed-pumps-copy"]) === "feed-pumps-copy-2",
    "when -copy is already taken, the next numbered candidate is returned",
  );
  assert(
    freeSlug("feed-pumps", ["feed-pumps-copy", "feed-pumps-copy-2", "feed-pumps-copy-3"]) ===
      "feed-pumps-copy-4",
    "every taken candidate up the chain is skipped in order",
  );
  assert(
    freeSlug("feed-pumps", new Set(["feed-pumps-copy"])) === "feed-pumps-copy-2",
    "a Set of taken slugs works the same as an array",
  );

  let threw = false;
  try {
    const allTaken = ["feed-pumps-copy", ...Array.from({ length: 49 }, (_, i) => `feed-pumps-copy-${i + 2}`)];
    freeSlug("feed-pumps", allTaken);
  } catch {
    threw = true;
  }
  assert(threw, "exhausting 50 attempts throws rather than returning a collision");

  const longBase = "a".repeat(64);
  const candidate = freeSlug(longBase, []);
  assert(
    candidate.length <= 64,
    `a 64-character base must still produce a slug within the 64-character bound — got length ${candidate.length}`,
  );
  assert(candidate.endsWith("-copy"), "the suffix survives even when the base had to be truncated");
}

/** `duplicatePayload` — the create body and the widget set, mapped from the source DTO. */
export function runDuplicatePayloadTests(): void {
  const source = sourceDashboard([
    widgetDto({ id: "widget-1", points: [point({ id: "point-row-1", pointId: "point-1" })] }),
    widgetDto({ id: "widget-2", points: [point({ id: "point-row-2", pointId: "point-2" })] }),
  ]);

  const payload = duplicatePayload(source, {
    organizationId: source.organizationId,
    scope: { locationId: null, assetGroupId: null },
    slug: "feed-pumps-copy",
    name: "Feed pumps (copy)",
  });

  assert(payload.create.organizationId === "org-1", "the create body carries the target organizationId");
  assert(payload.create.slug === "feed-pumps-copy", "the create body carries the target slug");
  assert(payload.create.name === "Feed pumps (copy)", "the create body carries the target name");
  assert(payload.create.description === "Original description", "the description is copied from the source");
  assert(
    payload.create.locationId === null && payload.create.assetGroupId === null,
    "the create body carries the TARGET scope, not the source's",
  );

  // The load-bearing assertion (plan §9): every source widget id is dropped.
  assert(payload.widgets.widgets.length === 2, "one payload widget per source widget");
  for (const widget of payload.widgets.widgets) {
    assert(
      !("id" in widget),
      `a duplicated widget must not carry the source widget's id — found one on ${JSON.stringify(widget)}`,
    );
  }
  assert(
    payload.widgets.widgets[0]!.points[0]!.pointId === "point-1" &&
      payload.widgets.widgets[1]!.points[0]!.pointId === "point-2",
    "the bound pointIds are copied even though the widget/point-row ids are not",
  );
}
