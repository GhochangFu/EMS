import type { MimicNodeDto, MimicPreset } from "@bms/shared";

import type { SiteLiveReadings } from "../../hooks/use-site-live-readings";
import { presetGeometry } from "../../lib/mimic-geometry";
import type { WidgetStatus } from "../../lib/widget-catalog";
import { MimicScene } from "./mimic-scene";
import { WidgetFrame } from "./widget-frame";

type MimicWidgetProps = {
  title: string;
  status: WidgetStatus;
  preset: MimicPreset;
  /** The resolved nodes, by key. A preset node with no entry here draws as "Not assigned". */
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
 * frame round `MimicScene` (`F3.32c`, ADR 0081 plan D10), which draws the preset's geometry.
 */
export function MimicWidget({ title, status, preset, nodes, readings }: MimicWidgetProps) {
  return (
    <WidgetFrame title={title} status={status}>
      <div className="min-h-0 flex-1">
        <MimicScene title={title} geometry={presetGeometry(preset)} nodes={nodes} readings={readings} />
      </div>
    </WidgetFrame>
  );
}
