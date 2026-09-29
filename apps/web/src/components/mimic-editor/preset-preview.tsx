import { MIMIC_PRESETS, mimicSymbolLibrary, type MimicPreset } from "@bms/shared";
import { useMemo } from "react";

import type { SiteLiveReadings } from "../../hooks/use-site-live-readings";
import { fromPreset } from "../../lib/mimic-editor";
import { layoutGeometry } from "../../lib/mimic-geometry";
import { MimicScene } from "../widgets/mimic-scene";

/**
 * `F3.32g` (owner ruling 2026-09-29) — the layout library's "Start from" preview: the drawing
 * Start will open, before the author opens it.
 *
 * **It draws `fromPreset`, not `presetGeometry`**: the starter rounds positions to the grid and
 * adds the sink as a passive unit, so the preset widget's drawing is not what Start builds. The
 * geometry goes through `layoutGeometry` exactly as `canvas.tsx` sends the editor's layout, so
 * the preview and the editor's first frame are one drawing.
 *
 * No live data: no query, no socket, every roled unit "Not assigned" — the editor's own rule.
 */

export type PresetPreviewProps = { preset: MimicPreset };

const NO_READINGS: SiteLiveReadings = {
  nowMs: 0,
  pointLatest: () => null,
  assetLastSeenMs: () => null,
};

export function PresetPreview({ preset }: PresetPreviewProps) {
  const layout = useMemo(() => fromPreset(preset), [preset]);
  const geometry = useMemo(
    () =>
      layoutGeometry({
        name: layout.name,
        canvasW: layout.canvasW,
        canvasH: layout.canvasH,
        nodes: [...layout.nodes],
        pipes: [...layout.pipes],
      }),
    [layout],
  );
  const units = layout.nodes.filter((node) => node.kind === "unit");
  const libraries = layout.symbolLibraries.map((code) => mimicSymbolLibrary(code).label).join(", ");

  return (
    <figure data-testid="mimic-preset-preview" data-preset={preset} className="max-w-4xl space-y-2">
      <div
        className="w-full rounded border border-line bg-surface"
        style={{ aspectRatio: `${layout.canvasW} / ${layout.canvasH}` }}
      >
        <MimicScene title={`${MIMIC_PRESETS[preset].label} preview`} geometry={geometry} nodes={[]} readings={NO_READINGS} />
      </div>
      <figcaption className="text-xs text-ink-muted">
        <span data-testid="mimic-preset-preview-counts">
          {units.length} units · {layout.pipes.length} pipes
        </span>
        {" · "}
        <span data-testid="mimic-preset-preview-libraries">{libraries}</span>
        {" — "}
        {units.map((unit) => unit.label).join(", ")}
      </figcaption>
    </figure>
  );
}
