import { expect } from "vitest";

import { putDashboardWidgetsBodySchema, TAB_KEY_UNKNOWN_MESSAGE } from "@bms/shared/contracts";

import { builderStateFromWidgetsFill, pointLabelsOf } from "./dashboard-builder-fill";
import { blankDashboardWidgetRow, buildPutWidgetsPayload, type DashboardWidgetRow, type TabWritePayload } from "./dashboard-builder-form";

/**
 * `F4.245` (owner ruling 3) — a `dashboard.widgets.replace` fill reaches the
 * canvas rows and tabs. Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

const POINT = "11111111-1111-4111-8111-111111111111";
const WIDGET = "22222222-2222-4222-8222-222222222222";
const TAB = "33333333-3333-4333-8333-333333333333";

const TABS: TabWritePayload[] = [{ id: TAB, key: "main", label: "Main", sortOrder: 0, assetGroupId: null }];

function row(type: Parameters<typeof blankDashboardWidgetRow>[0], over: Partial<DashboardWidgetRow>): DashboardWidgetRow {
  return { ...blankDashboardWidgetRow(type), tabKey: "main", ...over };
}

const ROWS: DashboardWidgetRow[] = [
  row("value_tile", { id: WIDGET, title: "Flow", points: [{ pointId: POINT, role: "primary", sortOrder: 0, label: "flow (m3/h)" }] }),
  row("radial_gauge", { title: "Level", gridX: 4, points: [{ pointId: POINT, role: "primary", sortOrder: 0, label: "flow (m3/h)" }] }),
];

/** The fill the builder itself would send: the round trip's input. */
const BODY = buildPutWidgetsPayload(ROWS, TABS);

/** Mutation: drop the `tabKey` spread — the rebuilt body loses each widget's tab. */
export function aLayoutFillRoundTripsThroughTheCanvas(): void {
  expect(putDashboardWidgetsBodySchema.safeParse(BODY).success).toBe(true);
  const state = builderStateFromWidgetsFill(BODY, pointLabelsOf(ROWS));
  if (!state.ok) throw new Error(state.problem);
  expect(buildPutWidgetsPayload(state.rows, state.tabs)).toEqual(BODY);
}

/** Mutation: always use the id as the label — the canvas shows the uuid instead of the point's name. */
export function aPointLabelIsReadFromTheCanvas(): void {
  const state = builderStateFromWidgetsFill(BODY, pointLabelsOf(ROWS));
  expect(state.ok && state.rows[0]?.points[0]?.label).toBe("flow (m3/h)");
}

/** A point the canvas does not show yet is labelled by its id. */
export function anUnknownPointIsLabelledByItsId(): void {
  const state = builderStateFromWidgetsFill(BODY, new Map());
  expect(state.ok && state.rows[0]?.points[0]?.label).toBe(POINT);
}

/** Mutation: parse each widget alone (no body-level `tabRulesHold`) — a tab key no tab has passes. */
export function aWidgetOnAnUnknownTabIsRefused(): void {
  const body = { ...BODY, widgets: BODY.widgets.map((widget) => ({ ...widget, tabKey: "nope" })) };
  const state = builderStateFromWidgetsFill(body, new Map());
  expect(state.ok).toBe(false);
  expect(!state.ok && state.problem).toContain(TAB_KEY_UNKNOWN_MESSAGE);
}

export function aBodyThatIsNotALayoutIsRefusedWithoutAThrow(): void {
  const state = builderStateFromWidgetsFill({ tabs: [], widgets: "three gauges" }, new Map());
  expect(state.ok).toBe(false);
}
