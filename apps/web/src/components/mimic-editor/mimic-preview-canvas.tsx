import type { MimicLayoutWidgetNodesDto, PointKeyStateMapDto } from "@bms/shared";
import { useMemo } from "react";

import type { SiteLiveReadings } from "../../hooks/use-site-live-readings";
import { layoutGeometry } from "../../lib/mimic-geometry";
import { MimicScene } from "../widgets/mimic-scene";

export type MimicPreviewCanvasProps = {
  /** The preview read's one `source: "layout"` entry: the SAVED geometry and its resolved nodes. */
  entry: MimicLayoutWidgetNodesDto;
  readings: SiteLiveReadings;
  stateMaps: readonly PointKeyStateMapDto[];
  /** The page's local `previewKey` — never the editor reducer's selection. */
  selected: string | null;
  onSelect: (key: string | null) => void;
};

/**
 * `F4.308` (ADR 0081 Amendment 2 decision 5, plan C10) — "Preview with site"'s drawing: the saved
 * layout drawn by the dashboard's own `MimicScene` with the resolved nodes, the live readings and
 * the state maps, read-only.
 *
 * One select-only hit rect per ROLED unit (a passive unit, a panel and a label have nothing to
 * inspect): a click selects, a background click clears. No pointer capture, no drag, no resize
 * handle, no pipe mode — nothing here can change the layout. Hit rects are `fill="none"` with
 * `pointerEvents="all"`, as the editor canvas's are (the F3.65 gate refuses a named colour).
 */
export function MimicPreviewCanvas({ entry, readings, stateMaps, selected, onSelect }: MimicPreviewCanvasProps) {
  const geometry = useMemo(() => layoutGeometry(entry.layout), [entry.layout]);
  const roled = geometry.units.filter((unit) => unit.roleCode !== null);
  const selectedUnit = selected === null ? undefined : roled.find((unit) => unit.key === selected);

  return (
    <div
      data-testid="mimic-preview-canvas"
      className="surface-pressed relative w-full"
      style={{ aspectRatio: `${entry.layout.canvasW} / ${entry.layout.canvasH}` }}
    >
      <MimicScene title="Layout preview" geometry={geometry} nodes={entry.nodes} readings={readings} stateMaps={stateMaps}>
        <g data-testid="mimic-preview-overlay">
          <rect
            data-testid="mimic-preview-background"
            x={0}
            y={0}
            width={geometry.width}
            height={geometry.height}
            fill="none"
            pointerEvents="all"
            onClick={() => onSelect(null)}
          />
          {roled.map((unit) => (
            <rect
              key={unit.key}
              data-testid="mimic-preview-hit"
              data-node-key={unit.key}
              x={unit.box.x}
              y={unit.box.y}
              width={unit.box.w}
              height={unit.box.h}
              fill="none"
              pointerEvents="all"
              className="cursor-pointer"
              onClick={(event) => {
                event.stopPropagation();
                onSelect(unit.key);
              }}
            />
          ))}
          {selectedUnit !== undefined ? (
            <rect
              data-testid="mimic-preview-selection"
              data-node-key={selectedUnit.key}
              x={selectedUnit.box.x}
              y={selectedUnit.box.y}
              width={selectedUnit.box.w}
              height={selectedUnit.box.h}
              fill="none"
              strokeWidth={2}
              pointerEvents="none"
              className="stroke-accent"
            />
          ) : null}
        </g>
      </MimicScene>
    </div>
  );
}
