import type { MimicNodeDto } from "@bms/shared";

import type { SiteLiveReadings } from "../../hooks/use-site-live-readings";
import type { MimicGeometry } from "../../lib/mimic-geometry";
import type { WidgetStatus } from "../../lib/widget-catalog";
import { MimicScene } from "./mimic-scene";
import { WidgetFrame } from "./widget-frame";

type MimicWidgetProps = {
  title: string;
  status: WidgetStatus;
  /** What to draw — `presetGeometry(preset)`, `layoutGeometry(layout)` or `EMPTY_GEOMETRY`. */
  geometry: MimicGeometry;
  /** The resolved nodes, by key. A roled unit with no entry here draws as "Not assigned". */
  nodes: readonly MimicNodeDto[];
  readings: SiteLiveReadings;
};

/** No resolved node — what `DashboardWidget` draws, having no node read of its own. */
export const NO_MIMIC_NODES: readonly MimicNodeDto[] = [];

/** No live overlay: every point reads the shared dash and every asset reads `none`. */
export const NO_LIVE_READINGS: SiteLiveReadings = {
  nowMs: 0,
  pointLatest: () => null,
  assetLastSeenMs: () => null,
};

/**
 * `F3.32` U4, redrawn by `F3.32b` (ADR 0079 Amendment 2) — the plant mimic widget: the widget
 * frame round `MimicScene`. Since `F3.32c` (ADR 0081, plan D10) one renderer draws a preset and
 * a stored layout alike; the caller picks the geometry (`MimicWidgetLive` by the resolver's
 * `source`).
 */
export function MimicWidget({ title, status, geometry, nodes, readings }: MimicWidgetProps) {
  return (
    <WidgetFrame title={title} status={status}>
      <div className="min-h-0 flex-1">
        <MimicScene title={title} geometry={geometry} nodes={nodes} readings={readings} />
      </div>
    </WidgetFrame>
  );
}
