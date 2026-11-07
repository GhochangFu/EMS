import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { MAX_DASHBOARD_WIDGETS, TREND_STRIP_WIDGET_MAX_POINTS } from "@bms/shared";
import { SERIES_ROLE_NAMES, TREND_STRIP_POINT_STYLES, trendStripRangeSchema } from "@bms/shared/contracts";
import type { SeriesRole, SiteTrendPointsDto, TrendStripPointStyle, TrendStripRange } from "@bms/shared";

import { appendTrendStripWidgets } from "../../api/dashboards";
import { fetchSiteTrendPoints } from "../../api/site-trend-points";
import { ApiError } from "../../lib/api-error";
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
import { TrendStripBody } from "../control-room/trend-strip-body";

/** A 409 from the trend arm: a chosen tab holds the widget cap (nothing was written). */
export const TREND_STRIP_WIZARD_FULL_SENTENCE = `That tab is full (${MAX_DASHBOARD_WIDGETS} widgets).`;
/** A 403 or a 404: a dashboard the caller may not manage, or one it cannot see. */
export const TREND_STRIP_WIZARD_REFUSED_SENTENCE = "You cannot set up strips on this dashboard.";
/** A 400: the selection no longer matches the site's lists (another administrator edited them). */
export const TREND_STRIP_WIZARD_LISTS_CHANGED_SENTENCE =
  "The site's trend-point lists changed. Close the wizard and open it again.";
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

const STEPS = ["Site", "Tabs", "Segments", "Points", "Range", "Preview"] as const;
const RANGE_LABELS: Record<TrendStripRange, string> = { "24h": "24 hours", "7d": "7 days", "30d": "30 days" };

/**
 * Where Finish goes. `draft` (the builder): the rows with each chosen tab's strip set, handed to
 * `onApply` — no request; the builder's Save writes them. `append` (the site view): one trend-arm
 * request, then `onDone`.
 */
export type TrendStripWizardMode =
  | { readonly kind: "draft"; readonly rows: readonly DashboardWidgetRow[]; readonly onApply: (rows: DashboardWidgetRow[]) => void }
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
 * catalog entry): Site → Tabs → Segments → Points → Range → Preview, then Finish. Every rule is in
 * `lib/trend-strip-wizard.ts`; this file holds the steps' state. One selection applies to every
 * chosen tab. A failure is one of four fixed sentences by status. It names no segment (§5.4).
 */
export function TrendStripWizard({ dashboard, mode, onClose }: TrendStripWizardProps) {
  const [step, setStep] = useState(0);
  const [chosenTabs, setChosenTabs] = useState<readonly string[]>([]);
  const [selection, setSelection] = useState<WizardSelection>(EMPTY);
  // The segments that have had their default points (plan D1); an unticked segment leaves the set.
  const [defaulted, setDefaulted] = useState<readonly string[]>([]);
  const [range, setRange] = useState<TrendStripRange>(trendStripRangeSchema.options[0]);
  const [previewTab, setPreviewTab] = useState<string | null>(null);
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

  const canGoOn =
    step === 1 ? chosen.length > 0 : step === 2 ? selection.segments.length > 0 && listsQ.isSuccess : true;

  const goNext = (): void => {
    // Entering Points: keep every chosen point and colour; default only the segments new since the last visit.
    if (step === 2) {
      setSelection(addDefaultsFor(lists, selection, selection.segments.filter((code) => !defaulted.includes(code))));
      setDefaulted(selection.segments);
    }
    setStep(step + 1);
  };

  const finish = async (): Promise<void> => {
    if (pending) return;
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
              {tab.hasStrip ? <span className="text-xs text-ink-muted">Replaces this tab's strip</span> : null}
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
                            {/* `F4.322` PR 3 (ADR 0108 Amendment 8) — the point's draw style. */}
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

      {step === 5 && shownTab !== undefined && previewConfig !== null ? (
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
