import { render, screen } from "@testing-library/react";
import { expect, vi } from "vitest";

import type { DashboardWidgetDto, WidgetType } from "@bms/shared";

import { WIDGET_CATALOG } from "../../lib/widget-catalog";
import { DashboardWidget, type WidgetData } from "./dashboard-widget";

/**
 * `F3.1c` — what a person actually sees when a widget renders (ADR 0042
 * decision 5).
 *
 * Assertions live here; `dashboard-widget.test.tsx` is the Vitest entry point
 * and carries the `@vitest-environment jsdom` docblock, because that is the
 * file Vitest collects (ADR 0014, ADR 0042 decision 2).
 *
 * **Why this file exists.** Every other `F3.1c` spec asserts a pure function —
 * `buildRadialGaugeOption`, `tankFillGeometry`, `toKpiTileProps`, the catalog.
 * None of them renders anything, so none of them can catch a component that
 * computes the right value and then draws the wrong thing: a `WidgetFrame`
 * that renders its chart in the `error` arm, a `ValueTileWidget` "tidied" into
 * a second frame, a title read straight off the DTO so an untitled widget
 * shows a blank heading. Those are runtime decisions and the compiler holds
 * none of them.
 *
 * **What this file deliberately does not assert.** `echarts-for-react` is
 * mocked to render nothing. ECharts draws onto a canvas, and jsdom implements
 * no canvas; the alternatives were a new `canvas` dependency (AGENTS.md §9.4,
 * ADR-gated, for a test) or a fake accessible name on the stub, which would
 * assert a label the real component does not give a screen reader and would
 * hide that gap rather than record it. So `radial_gauge` and `chart` are
 * asserted **through their frame only** — title, and the three non-ready
 * states. What goes *into* ECharts is asserted directly, and with mutation
 * proof, in `widget-echarts-option.spec.ts`.
 *
 * `tank_level` and `value_tile` are plain SVG and DOM, so those two are
 * asserted in full.
 */

vi.mock("echarts-for-react", () => ({
  default: () => null,
}));

const IDENTITY = {
  id: "11111111-1111-4111-8111-111111111111",
  dashboardId: "22222222-2222-4222-8222-222222222222",
  organizationId: "33333333-3333-4333-8333-333333333333",
  gridX: 0,
  gridY: 0,
  gridW: 4,
  gridH: 4,
  // Not `as const`: that widens `points` to `readonly []`, which the DTO's
  // mutable array does not accept.
  points: [],
};

const READY_AT_750: WidgetData = { status: "ready", primary: 750, series: [], stale: false };

/**
 * A widget of each type, with the smallest config its arm accepts.
 *
 * The gauge range is `6..12` rather than `0..100` on purpose. `0..100` is both
 * ECharts' own default and the identity of the reading→fraction conversion, so
 * a fixture built on it cannot fail when that conversion is dropped — two
 * mutations survived a green suite on exactly that fixture during `F3.1c`.
 * Nothing here renders the gauge, but the fixture is copied, so it does not
 * re-plant the trap.
 */
function sampleWidget(widgetType: WidgetType, title: string | null = "Feed pump power"): DashboardWidgetDto {
  switch (widgetType) {
    case "radial_gauge":
      return { ...IDENTITY, title, widgetType, config: { min: 6, max: 12 } };
    case "tank_level":
      return { ...IDENTITY, title, widgetType, config: { fullScale: 1000, decimals: 1 } };
    case "value_tile":
      return { ...IDENTITY, title, widgetType, config: { unit: "kW", decimals: 1 } };
    case "chart":
      return { ...IDENTITY, title, widgetType, config: { series: "line" } };
    default: {
      const unreachable: never = widgetType;
      return unreachable;
    }
  }
}

const WIDGET_TYPES = Object.keys(WIDGET_CATALOG) as WidgetType[];

/**
 * Every type in the catalog draws something a person can read.
 *
 * The `switch` in `DashboardWidget` is compiler-held, so this cannot catch a
 * missing `case`. It catches the next one along: an arm that renders but shows
 * nothing — and it grows on its own the day a fifth type joins the catalog,
 * which a hand-written list of four would not.
 */
export function everyCatalogTypeDrawsItsTitle(): void {
  expect(
    WIDGET_TYPES.length,
    "the catalog holds four widget types (ADR 0047 decision 2). A zero means the walk is broken and the " +
      "loop below asserts nothing; a five means a type was added — widen this number and say so.",
  ).toBe(4);

  for (const widgetType of WIDGET_TYPES) {
    const { unmount } = render(<DashboardWidget widget={sampleWidget(widgetType)} data={READY_AT_750} />);
    expect(screen.getByText("Feed pump power"), `${widgetType} rendered no title`).toBeInTheDocument();
    unmount();
  }
}

/**
 * An untitled widget shows its catalog label, not a blank heading.
 *
 * Migration `0050` permits `title NULL`, and `dashboardDtoSchema` dropped
 * `.min(1)` so the empty string is storable too. `widgetTitle` handles both;
 * this is the assertion that the component actually calls it, rather than
 * rendering `widget.title` and leaving the author looking at an empty card.
 */
export function anUntitledWidgetFallsBackToItsCatalogLabel(): void {
  const { unmount } = render(<DashboardWidget widget={sampleWidget("radial_gauge", null)} data={READY_AT_750} />);
  expect(screen.getByText(WIDGET_CATALOG.radial_gauge.label)).toBeInTheDocument();
  unmount();

  render(<DashboardWidget widget={sampleWidget("tank_level", "")} data={READY_AT_750} />);
  expect(screen.getByText(WIDGET_CATALOG.tank_level.label)).toBeInTheDocument();
}

/**
 * A ready tank shows its percentage, and names the vessel to a screen reader.
 *
 * 750 of a 1000 full scale at one decimal reads "75.0%". The same string is
 * the vessel's accessible name, because an SVG with no name is an unlabelled
 * graphic to anyone not looking at it.
 */
export function aReadyTankShowsItsPercentageAndNamesTheVessel(): void {
  render(<DashboardWidget widget={sampleWidget("tank_level", "Clarifier tank")} data={READY_AT_750} />);

  expect(screen.getByText("75.0%")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Clarifier tank: 75.0%" })).toBeInTheDocument();
}

/**
 * A live tank with no reading says so inside the vessel.
 *
 * `status: "ready"` with `primary: null` is a bound widget whose points were
 * all deleted (ADR 0047 Amendment 1 — `ON DELETE CASCADE` can take a live
 * widget to zero bindings). It is **not** the frame's `empty` state, so a
 * person sees an empty vessel with a legend, not the frame placeholder — the
 * two strings differ by a full stop, which is what keeps this assertion and
 * the one below from matching each other's text.
 */
export function aLiveTankWithNoReadingSaysSoInsideTheVessel(): void {
  render(
    <DashboardWidget
      widget={sampleWidget("tank_level", "Clarifier tank")}
      data={{ status: "ready", primary: null, series: [], stale: false }}
    />,
  );

  expect(screen.getByRole("img", { name: "Clarifier tank: No data bound" })).toBeInTheDocument();
  expect(screen.queryByText("No data bound.")).not.toBeInTheDocument();

  // The words go to the accessible name; the vessel draws the em dash. Drawing
  // the sentence overflowed the 100-unit viewBox on both sides — the §4.6
  // browser pass rendered it as "lo data bound", clipped by the card.
  expect(screen.getByText("—")).toBeInTheDocument();
  expect(screen.queryByText("No data bound")).not.toBeInTheDocument();
}

/**
 * Each non-ready state replaces the widget body — it does not draw over it.
 *
 * This is the load-bearing assertion in the file. `renderBody`'s arms are a
 * runtime decision, and the shape it replaced (an if/else whose final `else`
 * rendered `children`) would show a live-looking vessel while the fetch was
 * failing. A reader cannot tell a stale reading from a failed one, so the
 * absence of the vessel matters as much as the message.
 */
export function eachNonReadyStateReplacesTheWidgetBody(): void {
  const cases = [
    { status: "loading", message: "Loading…" },
    { status: "error", message: "Could not load widget." },
    { status: "empty", message: "No data bound." },
  ] as const;

  for (const { status, message } of cases) {
    const { unmount } = render(
      <DashboardWidget widget={sampleWidget("tank_level", "Clarifier tank")} data={{ status }} />,
    );

    expect(screen.getByText(message), `the ${status} state showed no message`).toBeInTheDocument();
    expect(screen.queryByRole("img"), `the ${status} state still drew the tank`).not.toBeInTheDocument();
    unmount();
  }
}

/**
 * A ready widget shows none of the three placeholders.
 *
 * The other direction of the assertion above: `case "ready"` must hand back
 * its children. Run on `chart`, whose body is mocked away here, so the only
 * thing it can observe is that no placeholder took the body's place.
 */
export function aReadyWidgetShowsNoPlaceholder(): void {
  render(<DashboardWidget widget={sampleWidget("chart")} data={READY_AT_750} />);

  for (const placeholder of ["Loading…", "Could not load widget.", "No data bound."]) {
    expect(screen.queryByText(placeholder), `a ready chart showed "${placeholder}"`).not.toBeInTheDocument();
  }
}

/**
 * A value tile draws one card, with one heading.
 *
 * `ValueTileWidget` composes `KpiTile`, which is already its own frame, and
 * deliberately does not wrap in `WidgetFrame` — the one asymmetry among the
 * four renderers. Wrapping it "for consistency" is a tidy-up someone will
 * reach for, and it draws two borders around one tile. The visible symptom is
 * the title rendered twice, once by each frame, which is what this counts.
 */
export function aValueTileDrawsOneCardWithOneHeading(): void {
  render(<DashboardWidget widget={sampleWidget("value_tile")} data={READY_AT_750} />);

  expect(screen.getAllByText("Feed pump power")).toHaveLength(1);
}

/**
 * A ready value tile shows the formatted reading and its unit, once each.
 *
 * `toKpiTileProps` passes `unit` to `KpiTile` as its own prop rather than into
 * `formatWidgetValue`'s `unit` option; feeding it to both renders "750.0 kW
 * kW", which is why the value is matched as its own exact string here.
 */
export function aReadyValueTileShowsTheFormattedReadingAndItsUnit(): void {
  render(<DashboardWidget widget={sampleWidget("value_tile")} data={READY_AT_750} />);

  expect(screen.getByText("750.0")).toBeInTheDocument();
  expect(screen.getByText("kW")).toBeInTheDocument();
}

/**
 * A failed value tile shows `KpiTile`'s own failure line, not the frame's.
 *
 * Recorded rather than corrected. Because a value tile is not inside a
 * `WidgetFrame`, a failing tile reads "Could not load" while a failing tank
 * beside it on the same dashboard reads "Could not load widget." — two
 * wordings for one condition, visible side by side. Deciding which one wins is
 * `F3.1d`'s, when the two sit in a grid together; this pins today's behaviour
 * so the change is a deliberate edit to a named assertion.
 */
export function aFailedValueTileShowsTheTilesOwnFailureLine(): void {
  render(<DashboardWidget widget={sampleWidget("value_tile")} data={{ status: "error" }} />);

  expect(screen.getByText("Could not load")).toBeInTheDocument();
  expect(screen.queryByText("Could not load widget.")).not.toBeInTheDocument();
}

const STALE_AT_750: WidgetData = { status: "ready", primary: 750, series: [], stale: true };

/**
 * Review finding (HIGH) — a `WidgetFrame`-backed widget (everything but `value_tile`) must say
 * it is offline when its reading is stale, WITHOUT hiding the reading itself: the value is
 * still honest evidence, just old, the same call `KpiTile`'s own `stale` ring already makes
 * elsewhere in this app. This is the assertion `widgetDataFor`'s own staleness computation would
 * be invisible without — a correct `stale: true` that no renderer reads is the same defect as
 * never computing it.
 */
export function aStaleReadyWidgetSaysOfflineWithoutHidingTheReading(): void {
  render(<DashboardWidget widget={sampleWidget("tank_level", "Clarifier tank")} data={STALE_AT_750} />);

  expect(screen.getByText("Offline")).toBeInTheDocument();
  // The vessel still draws — a stale reading is not the same state as no reading at all.
  expect(screen.getByRole("img", { name: "Clarifier tank: 75.0%" })).toBeInTheDocument();
}

/** A fresh, ready `WidgetFrame` widget shows no "Offline" badge — the narrow half of the
 * assertion above, so the fix is a signal on stale data and not a badge shown unconditionally. */
export function aFreshReadyWidgetShowsNoOfflineBadge(): void {
  render(<DashboardWidget widget={sampleWidget("tank_level", "Clarifier tank")} data={READY_AT_750} />);

  expect(screen.queryByText("Offline")).not.toBeInTheDocument();
}

/** `value_tile` does not go through `WidgetFrame` (it composes `KpiTile` directly), so its own
 * stale indicator is `KpiTile`'s existing ring + note — the same idiom `dashboard-page.tsx`
 * already drives from ADR 0027, reused rather than a second wording invented for this row. */
export function aStaleReadyValueTileShowsKpiTilesOwnStaleNote(): void {
  render(<DashboardWidget widget={sampleWidget("value_tile")} data={STALE_AT_750} />);

  expect(screen.getByText(/stale/i)).toBeInTheDocument();
  expect(screen.getByText("750.0")).toBeInTheDocument();
}
