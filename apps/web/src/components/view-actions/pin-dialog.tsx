import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { MAX_DASHBOARD_WIDGETS, MAX_WIDGET_POINTS, MAX_WIDGET_WINDOW_MINUTES } from "@bms/shared";
import type {
  AppendChartWidgetBody,
  ChartSeriesKind,
  EnergyViewRange,
  PointAggregateFunction,
  SiteSegmentViewsDto,
  UserRole,
} from "@bms/shared";

import { appendChartWidget, fetchDashboard, fetchDashboards } from "../../api/dashboards";
import { canAuthorDashboards } from "../../lib/admin-access";
import { ApiError } from "../../lib/api-error";
import { HISTORY_PRESETS, type HistoryRange } from "../../lib/asset-history-range";
import { chartKindChoices } from "../../lib/chart-kind-fit";
import { WIDGET_CATALOG } from "../../lib/widget-catalog";

/** A 409 from the append route: the chosen tab (or the single canvas) holds the widget cap. */
export const PIN_FULL_SENTENCE = `That tab is full (${MAX_DASHBOARD_WIDGETS} widgets).`;
/** A 403 or a 404: a dashboard the caller may not manage, or one it cannot see. */
export const PIN_REFUSED_SENTENCE = "You cannot pin to that dashboard.";
/** Every other failure. Never the error's message (`F4.204`). */
export const PIN_FAILED_SENTENCE = "Pin failed.";

/**
 * What a point view pins: its (asset, point) pairs, the function its chart reads, its range key and
 * the span it shows, and the title the dialog starts with.
 */
export type PinSource = {
  readonly pairs: readonly { readonly assetId: string; readonly pointKey: string }[];
  readonly aggregate: PointAggregateFunction;
  /** A preset key (`15m` … `1y`) pins its own length; any other key pins the span `from`–`to`. */
  readonly range: string;
  readonly from?: string;
  readonly to?: string;
  readonly title: string;
};

/**
 * The trailing window a pin stores, in minutes. A preset pins its own length; a custom range,
 * `today` and `this_month` pin a window as long as the span shown, `ceil((to − from) / 60 000)`,
 * and `spanned` says so (the dialog then names the window). `null` without a readable span, or
 * with one past `MAX_WIDGET_WINDOW_MINUTES` (the append route refuses it; Pin stays disabled).
 */
export function pinWindow(source: PinSource): { minutes: number; spanned: boolean } | null {
  const preset = HISTORY_PRESETS.find((p) => p.key === source.range);
  if (preset !== undefined) {
    return { minutes: preset.minutes, spanned: false };
  }
  const ms = Date.parse(source.to ?? "") - Date.parse(source.from ?? "");
  if (!Number.isFinite(ms) || ms <= 0) {
    return null;
  }
  const minutes = Math.ceil(ms / 60_000);
  return minutes > MAX_WIDGET_WINDOW_MINUTES ? null : { minutes, spanned: true };
}

/** `2190` → `36 h 30 min`; `45` → `45 min`; `1440` → `24 h`. */
export function formatPinWindow(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) {
    return `${rest} min`;
  }
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** Asset history: its chosen points on its asset, with the page's function. */
export function historyPinSource(
  assetCode: string,
  assetId: string,
  range: HistoryRange,
  selected: readonly string[],
): PinSource {
  return {
    pairs: selected.map((pointKey) => ({ assetId, pointKey })),
    aggregate: range.fn,
    range: range.range,
    from: range.from,
    to: range.to,
    title: `${assetCode} · ${selected.join(", ")}`.slice(0, 255),
  };
}

/**
 * A segment sub-tab: its drawn series only — the ranking entries that carry buckets — each on the
 * sub-tab's point, with `avg`, the weighted mean the sub-tab shows. The span is the period the
 * response names, so `today` and `this_month` pin what the sub-tab drew.
 */
export function segmentPinSource(data: SiteSegmentViewsDto, range: EnergyViewRange): PinSource {
  const point = data.point;
  const pairs =
    point === null
      ? []
      : data.ranking
          .filter((entry) => entry.buckets !== null)
          .slice(0, MAX_WIDGET_POINTS)
          .map((entry) => ({ assetId: entry.assetId, pointKey: point.code }));
  const label = data.segment?.label;
  const name = point?.name ?? "";
  return {
    pairs,
    aggregate: "avg",
    range,
    from: data.current.from,
    to: data.current.to,
    title: (label === undefined ? name : `${label} · ${name}`).slice(0, 255),
  };
}

function failureSentence(err: unknown): string {
  if (err instanceof ApiError && err.status === 409) {
    return PIN_FULL_SENTENCE;
  }
  if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
    return PIN_REFUSED_SENTENCE;
  }
  return PIN_FAILED_SENTENCE;
}

type Pinned = { readonly name: string; readonly slug: string; readonly organizationId: string };

function PinDialog({ source, onClose }: { source: PinSource; onClose: () => void }) {
  const [dashboardId, setDashboardId] = useState("");
  const [tabKey, setTabKey] = useState("");
  const [title, setTitle] = useState(source.title);
  // `F4.324` (ADR 0108 Amendment 9 item 2) — the chart kind; *Trend* (`line`) sends no `series`.
  const [kind, setKind] = useState<ChartSeriesKind>("line");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [pinned, setPinned] = useState<Pinned | null>(null);

  const listQ = useQuery({ queryKey: ["dashboards", "pin-targets"], queryFn: () => fetchDashboards() });
  const chosen = listQ.data?.items.find((d) => d.id === dashboardId);
  const detailQ = useQuery({
    queryKey: ["dashboards", "pin-target", chosen?.slug ?? "", chosen?.organizationId ?? ""],
    queryFn: () => fetchDashboard(chosen?.slug ?? "", chosen?.organizationId),
    enabled: chosen !== undefined,
  });
  const tabs = [...(detailQ.data?.tabs ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const effectiveTab = tabs.some((t) => t.key === tabKey) ? tabKey : (tabs[0]?.key ?? "");
  const span = pinWindow(source);
  const kinds = span === null ? [] : chartKindChoices({ pointCount: source.pairs.length, windowMinutes: span.minutes });
  // A chosen kind that stopped fitting (the view changed while the dialog is open) is never swapped
  // for another: it stays chosen, its reason shows under the select, and Pin waits for a new pick.
  const kindReason = kinds.find((k) => k.value === kind)?.disabledReason ?? null;
  // Done once pinned: a second click would append a duplicate. Another dashboard or tab clears it.
  const ready =
    chosen !== undefined &&
    detailQ.isSuccess &&
    span !== null &&
    source.pairs.length > 0 &&
    pinned === null &&
    kindReason === null;

  const submit = async (): Promise<void> => {
    if (pending || !ready || chosen === undefined || span === null) {
      return;
    }
    const size = WIDGET_CATALOG.chart.defaultSize;
    const trimmed = title.trim();
    const body: AppendChartWidgetBody = {
      ...(effectiveTab === "" ? {} : { tabKey: effectiveTab }),
      ...(trimmed === "" ? {} : { title: trimmed }),
      gridW: size.w,
      gridH: size.h,
      config: {
        windowMinutes: span.minutes,
        aggregate: source.aggregate,
        ...(kind === "line" ? {} : { series: kind }),
      },
      points: source.pairs.map((pair) => ({ assetId: pair.assetId, pointKey: pair.pointKey })),
    };
    setPending(true);
    setFailure(null);
    try {
      await appendChartWidget(chosen.id, body);
      setPinned({ name: chosen.name, slug: chosen.slug, organizationId: chosen.organizationId });
    } catch (err) {
      setFailure(failureSentence(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Pin to a dashboard"
      className="surface-raised mt-2 grid w-full max-w-md gap-2 p-3 text-sm"
    >
      {listQ.isError ? (
        <p role="alert" className="text-xs text-critical-ink">
          Could not load your dashboards.
        </p>
      ) : (
        <label className="grid gap-1 text-xs text-ink-muted">
          Dashboard
          <select
            className="surface-field px-2 py-1.5 text-sm"
            value={dashboardId}
            onChange={(event) => {
              setDashboardId(event.target.value);
              setTabKey("");
              setPinned(null);
              setFailure(null);
            }}
          >
            <option value="">{listQ.isLoading ? "Loading dashboards…" : "Choose a dashboard"}</option>
            {(listQ.data?.items ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {tabs.length === 0 ? null : (
        <label className="grid gap-1 text-xs text-ink-muted">
          Tab
          <select
            className="surface-field px-2 py-1.5 text-sm"
            value={effectiveTab}
            onChange={(event) => {
              setTabKey(event.target.value);
              setPinned(null);
            }}
          >
            {tabs.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {/* `F4.324` — every kind in the catalog's words; one the view cannot take stays listed,
          disabled, with its reason (owner ruling Q2), so an author learns what it needs. */}
      {kinds.length === 0 ? null : (
        <label className="grid gap-1 text-xs text-ink-muted">
          Chart kind
          <select
            className="surface-field px-2 py-1.5 text-sm"
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as ChartSeriesKind);
              setPinned(null);
            }}
          >
            {kinds.map((choice) => (
              <option key={choice.value} value={choice.value} disabled={choice.disabledReason !== null}>
                {choice.disabledReason === null ? choice.label : `${choice.label} — ${choice.disabledReason}`}
              </option>
            ))}
          </select>
        </label>
      )}
      {kindReason === null ? null : <p className="text-xs text-critical-ink">{kindReason}</p>}
      <label className="grid gap-1 text-xs text-ink-muted">
        Title
        <input
          className="surface-field px-2 py-1.5 text-sm"
          value={title}
          maxLength={255}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      {span !== null && span.spanned ? (
        <p className="text-xs text-ink-muted">{`Pins the last ${formatPinWindow(span.minutes)}, not these dates.`}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-busy={pending}
          disabled={pending || !ready}
          className="surface-button-primary bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent disabled:opacity-50"
          onClick={() => void submit()}
        >
          {pending ? "Pinning…" : "Pin to dashboard"}
        </button>
        <button type="button" className="rounded border border-line-strong px-2 py-1 text-xs" onClick={onClose}>
          Close
        </button>
      </div>
      {failure === null ? null : (
        <p role="alert" className="text-xs text-critical-ink">
          {failure}
        </p>
      )}
      {pinned === null ? null : (
        <p role="status" className="text-xs text-ink">
          Pinned to{" "}
          <Link
            className="underline"
            to={`/dashboards/${encodeURIComponent(pinned.slug)}?organizationId=${encodeURIComponent(pinned.organizationId)}`}
          >
            {pinned.name}
          </Link>
        </p>
      )}
    </div>
  );
}

type PinButtonProps = {
  /** The signed-in role; the button shows only where `canAuthorDashboards` admits it. */
  role: UserRole | undefined;
  source: PinSource;
};

/**
 * `F4.303` U15 (ADR 0108 Amendment 6 item 4) — "Pin" on a point view (asset history, a segment
 * sub-tab). It shows for a role that may author dashboards and a view with at least one series,
 * and opens the dialog inline under the control row: the caller's dashboards from `GET /dashboards`,
 * on a tabbed one its tabs, a title, and one trailing-window `chart` widget posted to the append
 * route with the view's function. The server decides who may pin where (item 5); a failure is one
 * of three fixed sentences picked by status.
 */
export function PinButton({ role, source }: PinButtonProps) {
  const [open, setOpen] = useState(false);
  if (role === undefined || !canAuthorDashboards(role) || source.pairs.length === 0) {
    return null;
  }
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        className="rounded border border-line-strong px-2 py-1 text-xs"
        onClick={() => setOpen((was) => !was)}
      >
        Pin
      </button>
      {open ? <PinDialog source={source} onClose={() => setOpen(false)} /> : null}
    </span>
  );
}
