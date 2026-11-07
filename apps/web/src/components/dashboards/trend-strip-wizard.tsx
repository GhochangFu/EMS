import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { MAX_DASHBOARD_WIDGETS, TREND_STRIP_WIDGET_MAX_POINTS } from "@bms/shared";
import { SERIES_ROLE_NAMES, TREND_STRIP_POINT_STYLES, trendStripRangeSchema } from "@bms/shared/contracts";
import type {
  ChartSeriesKind,
  PointAggregateFunction,
  SeriesRole,
  SiteTrendPointsDto,
  TrendStripPointStyle,
  TrendStripRange,
} from "@bms/shared";

import { fetchAssetPoints } from "../../api/assets";
import { appendChartWidget, appendTrendStripWidgets } from "../../api/dashboards";
import { fetchSiteTrendPoints } from "../../api/site-trend-points";
import { fetchSiteTrendStrip } from "../../api/trend-strip";
import { ApiError } from "../../lib/api-error";
import { chartKindChoices } from "../../lib/chart-kind-fit";
import type { DashboardWidgetRow } from "../../lib/dashboard-builder-form";
import {
  addDefaultsFor,
  appendBodyFor,
  canAddPoint,
  placeInDraft,
  selectionKey,
  POINT_STYLE_LABELS,
  setPointColor,
  setPointStyle,
  stripConfigFor,
  togglePoint,
  toggleSegment,
  wizardTabs,
  type WizardDashboard,
  type WizardSelection,
  type WizardTab,
} from "../../lib/trend-strip-wizard";
import {
  chartAppendBodyFor,
  chartPairsFor,
  chartProblemFor,
  chartRowFor,
  RANGE_MINUTES,
  type ChartPair,
  type DrawAs,
  type ResolvedChartPair,
} from "../../lib/trend-strip-wizard-chart";
import { AGGREGATE_FUNCTION_LABELS, AGGREGATE_FUNCTIONS } from "../../lib/widget-config-form";
import { TrendStripBody } from "../control-room/trend-strip-body";

/** A 409 from the trend arm: a chosen tab holds the widget cap (nothing was written). */
export const TREND_STRIP_WIZARD_FULL_SENTENCE = `That tab is full (${MAX_DASHBOARD_WIDGETS} widgets).`;
/** A 403 or a 404: a dashboard the caller may not manage, or one it cannot see. */
export const TREND_STRIP_WIZARD_REFUSED_SENTENCE = "You cannot set up strips or charts on this dashboard.";
/** `F4.324` — a 400 from the chart arm: a point or a tab no longer matches the dashboard. */
export const TREND_STRIP_WIZARD_CHART_CHANGED_SENTENCE =
  "A chosen point or tab no longer matches this dashboard. Close the wizard and open it again.";
/** A 400: the selection no longer matches the site's lists (another administrator edited them). */
export const TREND_STRIP_WIZARD_LISTS_CHANGED_SENTENCE =
  "The site's trend-point lists changed. Close the wizard and open it again.";
/** `F4.324` — a chart's point that the asset's point list no longer holds (the builder draft). */
export const TREND_STRIP_WIZARD_POINT_GONE_SENTENCE = "A chosen point is no longer on its asset. Close the wizard and open it again.";
/** Every other failure. Never the error's message (`F4.204`). */
export const TREND_STRIP_WIZARD_FAILED_SENTENCE = "Setup failed.";

/** The swatch of each series role: literal role classes, so Tailwind keeps them (no palette). */
const SWATCH: Record<SeriesRole, string> = {
  "series-1": "bg-series-1",
  "series-2": "bg-series-2",
  "series-3": "bg-series-3",
  "series-4": "bg-series-4",
  "series-5": "bg-series-5",
  "series-6": "bg-series-6",
  "series-7": "bg-series-7",
  "series-8": "bg-series-8",
};

// `F4.324` PR 2 (ADR 0108 Amendment 9 item 3): *Draw as* after Range, so a kind sees the window.
const STEPS = ["Site", "Tabs", "Segments", "Points", "Range", "Draw as", "Preview"] as const;
const PREVIEW_STEP = STEPS.length - 1;
const RANGE_LABELS: Record<TrendStripRange, string> = { "24h": "24 hours", "7d": "7 days", "30d": "30 days" };

/**
 * Where Finish goes. `draft` (the builder): the rows with each chosen tab's strip set, handed to
 * `onApply` — no write; the builder's Save writes them (a `F4.324` chart first reads each tab's
 * strip and its assets' point ids). `append` (the site view): one trend-arm request, or one chart
 * call per tab, then `onDone`.
 */
export type TrendStripWizardMode =
  | {
      readonly kind: "draft";
      readonly rows: readonly DashboardWidgetRow[];
      /**
       * The rows, or (`F4.324`, a chart) an updater over the builder's current rows: the chart path
       * awaits reads first, and an edit made meanwhile must survive (the builder passes `setRows`).
       */
      readonly onApply: (rows: DashboardWidgetRow[] | ((current: DashboardWidgetRow[]) => DashboardWidgetRow[])) => void;
    }
  | { readonly kind: "append"; readonly onDone: () => void };

type TrendStripWizardProps = {
  /**
   * The target dashboard: its id, its site (a dashboard without one is not offered the wizard), and
   * the site name the Site step shows (Amendment 7 item 5: shown, not chosen). `null` only where the
   * caller holds no name: the step then says "this dashboard's site".
   */
  dashboard: WizardDashboard & { readonly id: string; readonly locationId: string; readonly siteName: string | null };
  mode: TrendStripWizardMode;
  onClose: () => void;
};

function failureSentence(err: unknown): string {
  if (err instanceof ApiError && err.status === 409) return TREND_STRIP_WIZARD_FULL_SENTENCE;
  if (err instanceof ApiError && (err.status === 403 || err.status === 404)) return TREND_STRIP_WIZARD_REFUSED_SENTENCE;
  if (err instanceof ApiError && err.status === 400) return TREND_STRIP_WIZARD_LISTS_CHANGED_SENTENCE;
  return TREND_STRIP_WIZARD_FAILED_SENTENCE;
}

/** A tab's checkbox value: its key, or `""` for a dashboard without tabs (a tab key is never empty). */
function tabValue(tab: Pick<WizardTab, "key">): string {
  return tab.key ?? "";
}

const EMPTY: WizardSelection = { segments: [], points: [], colors: {} };

/**
 * `F4.306` PR 2 U12 (ADR 0108 Amendment 7 items 5–7; plan D4) — the trend strip setup dialog. A
 * self-contained stepper of the `PinDialog` shape, not `WizardShell` (plan Correction 3: no copilot
 * catalog entry): Site → Tabs → Segments → Points → Range → Draw as (`F4.324`) → Preview, then
 * Finish. Every rule is in `lib/trend-strip-wizard.ts` and, for a chart, `lib/trend-strip-wizard-chart.ts`;
 * this file holds the steps' state. One selection applies to every chosen tab. A failure is a fixed
 * sentence by status, or a chart's per-tab sentence. It names no segment (§5.4).
 */
export function TrendStripWizard({ dashboard, mode, onClose }: TrendStripWizardProps) {
  const [step, setStep] = useState(0);
  const [chosenTabs, setChosenTabs] = useState<readonly string[]>([]);
  const [selection, setSelection] = useState<WizardSelection>(EMPTY);
  // The segments that have had their default points (plan D1); an unticked segment leaves the set.
  const [defaulted, setDefaulted] = useState<readonly string[]>([]);
  const [range, setRange] = useState<TrendStripRange>(trendStripRangeSchema.options[0]);
  const [previewTab, setPreviewTab] = useState<string | null>(null);
  // `F4.324` PR 2 — Trend strip (today) or Chart; a chart needs a function, chosen by the author.
  const [drawAs, setDrawAs] = useState<"strip" | "chart">("strip");
  const [chartKind, setChartKind] = useState<ChartSeriesKind>("line");
  const [chartFn, setChartFn] = useState<PointAggregateFunction | "">("");
  // The tabs a part-failed chart Finish already wrote: skipped on the next Finish, never duplicated.
  const [writtenTabs, setWrittenTabs] = useState<readonly string[]>([]);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const listsQ = useQuery({
    queryKey: ["control-room", "trend-points", dashboard.locationId],
    queryFn: () => fetchSiteTrendPoints(dashboard.locationId),
    enabled: step >= 2,
  });
  const lists: SiteTrendPointsDto["segments"] = listsQ.data?.segments ?? [];
  const tabs = wizardTabs(dashboard);
  const chosen = tabs.filter((tab) => chosenTabs.includes(tabValue(tab)));
  const shownTab = chosen.find((tab) => tabValue(tab) === previewTab) ?? chosen[0];

  const chartChoice: Extract<DrawAs, { kind: "chart" }> | null =
    drawAs === "chart" && chartFn !== "" ? { kind: "chart", series: chartKind, aggregate: chartFn } : null;

  const canGoOn =
    step === 1
      ? chosen.length > 0
      : step === 2
        ? selection.segments.length > 0 && listsQ.isSuccess
        : step === 5
          ? drawAs === "strip" || chartChoice !== null
          : true;

  const goNext = (): void => {
    // Entering Points: keep every chosen point and colour; default only the segments new since the last visit.
    if (step === 2) {
      setSelection(addDefaultsFor(lists, selection, selection.segments.filter((code) => !defaulted.includes(code))));
      setDefaulted(selection.segments);
    }
    setStep(step + 1);
  };

  /** `F4.324` PR 2 — each chosen tab's chart pairs, read from its strip; a tab's problem stops the whole Finish. */
  const chartPairsByTab = async (choice: Extract<DrawAs, { kind: "chart" }>): Promise<ChartPair[][] | string> => {
    const out: ChartPair[][] = [];
    for (const tab of chosen) {
      const strip = await fetchSiteTrendStrip(dashboard.locationId, {
        range,
        assetGroupId: tab.assetGroupId,
        ...(selection.segments.length > 0 ? { segments: [...selection.segments] } : {}),
        ...(selection.points.length > 0 ? { points: [...selection.points] } : {}),
      });
      const { pairs, hidden } = chartPairsFor(strip, selection.points);
      // A tab already charted by an earlier, part-failed Finish is not refused for the chart it now holds.
      const widgetCount = writtenTabs.includes(tabValue(tab)) ? 0 : tab.count;
      const problem = chartProblemFor({ pairs, hidden, widgetCount }, choice, range);
      if (problem !== null) return `${tab.label}: ${problem}`;
      out.push(pairs);
    }
    return out;
  };

  const finishChart = async (choice: Extract<DrawAs, { kind: "chart" }>): Promise<void> => {
    setPending(true);
    setFailure(null);
    try {
      const byTab = await chartPairsByTab(choice);
      if (typeof byTab === "string") {
        setFailure(byTab);
        return;
      }
      if (mode.kind === "draft") {
        // The builder binds a point by its id: read each asset's point list once.
        const ids = new Map<string, string>();
        for (const assetId of new Set(byTab.flat().map((pair) => pair.assetId))) {
          for (const row of (await fetchAssetPoints(assetId)).items) ids.set(`${row.assetId}|${row.pointKey}`, row.id);
        }
        const perTab: { tabKey: string | undefined; pairs: ResolvedChartPair[] }[] = [];
        for (const [index, tab] of chosen.entries()) {
          const resolved: ResolvedChartPair[] = [];
          for (const pair of byTab[index] ?? []) {
            const pointId = ids.get(`${pair.assetId}|${pair.pointKey}`);
            if (pointId === undefined) {
              setFailure(TREND_STRIP_WIZARD_POINT_GONE_SENTENCE);
              return;
            }
            resolved.push({ ...pair, pointId });
          }
          perTab.push({ tabKey: tab.key ?? undefined, pairs: resolved });
        }
        // Against the builder's rows at apply time, not those at Finish: an edit made during the reads stays.
        mode.onApply((current) =>
          perTab.reduce(
            (rows, { tabKey, pairs }) => [...rows, chartRowFor(rows, pairs, choice, range, tabKey)],
            current,
          ),
        );
        onClose();
        return;
      }
      // One call per tab (the chart arm takes one widget), so a failure can come after a success:
      // each written tab is remembered and skipped on the next Finish, and the sentence names it.
      const written = [...writtenTabs];
      for (const [index, tab] of chosen.entries()) {
        if (written.includes(tabValue(tab))) continue;
        try {
          await appendChartWidget(dashboard.id, chartAppendBodyFor(byTab[index] ?? [], choice, range, tab.key));
        } catch (err) {
          setWrittenTabs(written);
          const done = chosen.filter((t) => written.includes(tabValue(t))).map((t) => t.label);
          const why = err instanceof ApiError && err.status === 400 ? TREND_STRIP_WIZARD_CHART_CHANGED_SENTENCE : failureSentence(err);
          setFailure(done.length === 0 ? `${tab.label}: ${why}` : `Added to ${done.join(", ")}. ${tab.label}: ${why}`);
          return;
        }
        written.push(tabValue(tab));
      }
      setWrittenTabs(written);
      mode.onDone();
    } catch (err) {
      setFailure(failureSentence(err));
    } finally {
      setPending(false);
    }
  };

  const finish = async (): Promise<void> => {
    if (pending) return;
    if (drawAs === "chart") {
      if (chartChoice !== null) await finishChart(chartChoice);
      return;
    }
    if (mode.kind === "draft") {
      let rows = [...mode.rows];
      for (const tab of chosen) rows = placeInDraft(rows, tab.key ?? undefined, stripConfigFor(selection, range, tab));
      mode.onApply(rows);
      onClose();
      return;
    }
    setPending(true);
    setFailure(null);
    try {
      await appendTrendStripWidgets(dashboard.id, appendBodyFor(selection, range, chosen));
      mode.onDone();
    } catch (err) {
      setFailure(failureSentence(err));
    } finally {
      setPending(false);
    }
  };

  const last = step === STEPS.length - 1;
  const previewConfig = shownTab === undefined ? null : stripConfigFor(selection, range, shownTab);

  return (
    <div role="dialog" aria-label="Trend strip setup" className="surface-raised grid w-full max-w-2xl gap-3 p-4 text-sm">
      <ol className="flex flex-wrap gap-2 text-xs text-ink-muted">
        {STEPS.map((name, index) => (
          <li key={name} aria-current={index === step ? "step" : undefined} className={index === step ? "font-semibold text-ink" : ""}>
            {`${index + 1}. ${name}`}
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <p>{`The strips draw the trend points of ${dashboard.siteName ?? "this dashboard's site"}.`}</p>
      ) : null}

      {step === 1 ? (
        <ul className="grid gap-1">
          {tabs.map((tab) => (
            <li key={tabValue(tab)} className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={chosenTabs.includes(tabValue(tab))}
                  disabled={tab.atCap}
                  onChange={() =>
                    setChosenTabs((was) =>
                      was.includes(tabValue(tab)) ? was.filter((value) => value !== tabValue(tab)) : [...was, tabValue(tab)],
                    )
                  }
                />
                {tab.label}
              </label>
              <span className="text-xs text-ink-muted">{tab.assetGroupId === null ? "Whole site" : "Its asset group"}</span>
              {tab.hasStrip && drawAs === "strip" ? (
                <span className="text-xs text-ink-muted">Replaces this tab's strip</span>
              ) : null}
              {tab.atCap ? <span className="text-xs text-ink-muted">{`Full (${MAX_DASHBOARD_WIDGETS} widgets)`}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {step === 2 ? (
        listsQ.isError ? (
          <p role="alert" className="text-xs text-critical-ink">
            The site's trend-point lists could not be read.
          </p>
        ) : listsQ.isSuccess ? (
          <ul className="grid gap-1">
            {lists.map((segment) => (
              <li key={segment.domain}>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selection.segments.includes(segment.domain)}
                    onChange={() => {
                      setSelection((was) => toggleSegment(was, segment.domain));
                      setDefaulted((was) => was.filter((code) => code !== segment.domain));
                    }}
                  />
                  {segment.label}
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-ink-muted">Loading the site's lists…</p>
        )
      ) : null}

      {step === 3 ? (
        <div className="grid gap-2">
          <p className="text-xs text-ink-muted">{`${selection.points.length} of ${TREND_STRIP_WIDGET_MAX_POINTS}`}</p>
          {lists
            .filter((segment) => selection.segments.includes(segment.domain))
            .map((segment) => (
              <fieldset key={segment.domain} className="grid gap-1">
                <legend className="text-xs font-semibold text-ink-muted">{segment.label}</legend>
                {segment.points
                  .filter((point) => point.active)
                  .map((point) => {
                    const key = selectionKey(segment.domain, point.code);
                    const on = selection.points.includes(key);
                    const role = selection.colors[key];
                    return (
                      <div key={key} className="flex flex-wrap items-center gap-2">
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={!on && !canAddPoint(selection)}
                            onChange={() => setSelection((was) => togglePoint(was, key))}
                          />
                          {point.name}
                        </label>
                        {on ? (
                          <span className="inline-flex items-center gap-1">
                            <span aria-hidden="true" className={`inline-block h-3 w-3 rounded-full ${role === undefined ? "bg-accent" : SWATCH[role]}`} />
                            <select
                              aria-label={`Colour of ${point.name}`}
                              className="surface-field px-2 py-1 text-xs"
                              value={role ?? ""}
                              onChange={(event) =>
                                setSelection((was) =>
                                  setPointColor(was, key, event.target.value === "" ? null : (event.target.value as SeriesRole)),
                                )
                              }
                            >
                              <option value="">Default</option>
                              {SERIES_ROLE_NAMES.map((name) => (
                                <option key={name} value={name}>
                                  {name}
                                </option>
                              ))}
                            </select>
                            {/* `F4.323` PR 3 (ADR 0108 Amendment 8) — the point's draw style. */}
                            <select
                              aria-label={`Style of ${point.name}`}
                              className="surface-field px-2 py-1 text-xs"
                              value={selection.styles?.[key] ?? "line"}
                              onChange={(event) =>
                                setSelection((was) => setPointStyle(was, key, event.target.value as TrendStripPointStyle))
                              }
                            >
                              {TREND_STRIP_POINT_STYLES.map((style) => (
                                <option key={style} value={style}>
                                  {POINT_STYLE_LABELS[style]}
                                </option>
                              ))}
                            </select>
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
              </fieldset>
            ))}
        </div>
      ) : null}

      {step === 4 ? (
        <fieldset className="flex gap-3">
          <legend className="text-xs text-ink-muted">Range the strips open on</legend>
          {trendStripRangeSchema.options.map((key) => (
            <label key={key} className="inline-flex items-center gap-1">
              <input type="radio" name="trend-strip-range" checked={range === key} onChange={() => setRange(key)} />
              {RANGE_LABELS[key]}
            </label>
          ))}
        </fieldset>
      ) : null}

      {step === 5 ? (
        <div className="grid gap-2">
          <fieldset className="flex gap-3">
            <legend className="sr-only">Draw as</legend>
            <label className="inline-flex items-center gap-2">
              <input type="radio" name="draw-as" checked={drawAs === "strip"} onChange={() => setDrawAs("strip")} />
              Trend strip
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="radio" name="draw-as" checked={drawAs === "chart"} onChange={() => setDrawAs("chart")} />
              Chart
            </label>
          </fieldset>
          {drawAs === "chart" ? (
            <>
              <p className="text-xs text-ink-muted">
                Each chosen tab gets one chart of the chosen points&rsquo; assets, at the foot of the tab.
              </p>
              <label className="grid gap-1 text-xs text-ink-muted">
                Chart kind
                <select
                  className="surface-field px-2 py-1.5 text-sm"
                  value={chartKind}
                  onChange={(event) => setChartKind(event.target.value as ChartSeriesKind)}
                >
                  {/* The fit is judged on the chosen points; Finish checks each tab's assets again. */}
                  {chartKindChoices({ pointCount: selection.points.length, windowMinutes: RANGE_MINUTES[range] }).map(
                    (choice) => (
                      <option key={choice.value} value={choice.value} disabled={choice.disabledReason !== null}>
                        {choice.disabledReason === null ? choice.label : `${choice.label} — ${choice.disabledReason}`}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label className="grid gap-1 text-xs text-ink-muted">
                Value
                <select
                  className="surface-field px-2 py-1.5 text-sm"
                  value={chartFn}
                  onChange={(event) => setChartFn(event.target.value as PointAggregateFunction | "")}
                >
                  <option value="">Choose a function</option>
                  {AGGREGATE_FUNCTIONS.map((fn) => (
                    <option key={fn} value={fn}>
                      {AGGREGATE_FUNCTION_LABELS[fn]}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
        </div>
      ) : null}

      {step === PREVIEW_STEP && shownTab !== undefined && previewConfig !== null ? (
        <div className="grid gap-2">
          {chosen.length > 1 ? (
            <label className="grid gap-1 text-xs text-ink-muted">
              Preview tab
              <select
                className="surface-field px-2 py-1.5 text-sm"
                value={tabValue(shownTab)}
                onChange={(event) => setPreviewTab(event.target.value)}
              >
                {chosen.map((tab) => (
                  <option key={tabValue(tab)} value={tabValue(tab)}>
                    {tab.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {drawAs === "chart" ? (
            <p className="text-xs text-ink-muted">
              The data each chart reads. The chart draws it as the chosen kind; colours and styles are the strip&rsquo;s only.
            </p>
          ) : null}
          <TrendStripBody
            key={tabValue(shownTab)}
            locationId={dashboard.locationId}
            assetGroupId={shownTab.assetGroupId}
            defaultRange={range}
            exportable={false}
            selection={{
              segments: previewConfig.segments,
              points: previewConfig.points,
              colors: previewConfig.colors,
              styles: previewConfig.styles,
            }}
          />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {step > 0 ? (
          <button type="button" className="surface-button px-3 py-1.5 text-xs" onClick={() => setStep(step - 1)}>
            Back
          </button>
        ) : null}
        {last ? (
          <button
            type="button"
            aria-busy={pending}
            disabled={pending || chosen.length === 0}
            className="surface-button-primary bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent disabled:opacity-50"
            onClick={() => void finish()}
          >
            {pending ? "Saving…" : "Finish"}
          </button>
        ) : (
          <button
            type="button"
            disabled={!canGoOn}
            className="surface-button-primary bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent disabled:opacity-50"
            onClick={goNext}
          >
            Next
          </button>
        )}
        <button type="button" className="surface-button px-3 py-1.5 text-xs" onClick={onClose}>
          Cancel
        </button>
      </div>
      {failure === null ? null : (
        <p role="alert" className="text-xs text-critical-ink">
          {failure}
        </p>
      )}
    </div>
  );
}
