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

/**
 * `F3.73` critique fixes — the height `WidgetFrame` adds round the drawing, in px: `p-3` top and
 * bottom (24), the 11 px title at the inherited 1.5 line height (16.5) and its `mb-2` (8), so
 * 48.5, rounded up. A view canvas adds it to the drawing's height for the mimic's minimum height.
 */
export const MIMIC_FRAME_CHROME_PX = 49;

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
 *
 * Since the `F3.77` follow-up (owner ruling Q4) the drawing sits in an `absolute inset-0` box, so
 * it adds no height of its own: the tile is as tall as the canvas's minimum height (the aspect
 * height, or the wall's cap) or its builder cell, and the `meet` drawing letterboxes inside it.
 */
export function MimicWidget({ title, status, geometry, nodes, readings }: MimicWidgetProps) {
  return (
    <WidgetFrame title={title} status={status}>
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0">
          <MimicScene title={title} geometry={geometry} nodes={nodes} readings={readings} />
        </div>
      </div>
    </WidgetFrame>
  );
}
