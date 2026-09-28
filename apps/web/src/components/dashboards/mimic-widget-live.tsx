import { useMemo } from "react";

import type { DashboardWidgetDto } from "@bms/shared";

import { useMimicNodes } from "../../hooks/use-mimic-nodes";
import { useSiteLiveReadings } from "../../hooks/use-site-live-readings";
import { mimicViewFor } from "../../lib/mimic";
import type { WidgetStatus } from "../../lib/widget-catalog";
import { widgetTitle } from "../../lib/widget-value";
import { MimicWidget, NO_MIMIC_NODES } from "../widgets/mimic-widget";

type MimicWidgetLiveProps = {
  widget: Extract<DashboardWidgetDto, { widgetType: "mimic" }>;
  dashboardId: string;
};

/**
 * `F3.32` U4 — one `mimic` widget's live binding (ADR 0079, plan D1/D2).
 *
 * - **One read per dashboard** (`useMimicNodes`, keyed on `dashboardId`), refetched every 30 s;
 *   this widget picks its own entry by `widgetId`. A widget the response does not list (saved
 *   after the read, or a row the server could not parse) draws every node "Not assigned".
 * - **F3.68's overlay, unchanged**: the assigned assets go to `useSiteLiveReadings` as a
 *   synthetic view, memoised on the read so the hook's clamp memo is not rerun each render. The
 *   socket is keyed on the widget, so two mimics each track their own assets.
 * - The frame shows loading until the first answer and the error line only when there is none —
 *   a failed 30 s refetch keeps the last good drawing.
 */
export function MimicWidgetLive({ widget, dashboardId }: MimicWidgetLiveProps) {
  const query = useMimicNodes(dashboardId);
  const entry = query.data?.widgets.find((w) => w.widgetId === widget.id);
  const resolvedAt = query.data?.resolvedAt ?? "";
  const view = useMemo(() => mimicViewFor(entry, resolvedAt), [entry, resolvedAt]);
  const readings = useSiteLiveReadings(widget.id, view, query.dataUpdatedAt);

  const status: WidgetStatus = query.data !== undefined ? "ready" : query.isError ? "error" : "loading";

  return (
    <MimicWidget
      title={widgetTitle(widget.title, widget.widgetType)}
      status={status}
      preset={entry?.preset ?? widget.config.preset}
      nodes={entry?.nodes ?? NO_MIMIC_NODES}
      readings={readings}
    />
  );
}
