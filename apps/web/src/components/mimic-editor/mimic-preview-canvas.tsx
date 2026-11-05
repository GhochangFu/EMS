import type { MimicLayoutWidgetNodesDto, PointKeyStateMapDto } from "@bms/shared";
import { useMemo, type KeyboardEvent } from "react";

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
 *
 * **Keyboard (WCAG 2.1.1).** Each hit rect is a `role="button"` in the Tab order, named by its
 * unit's label, `aria-pressed` when selected: Enter or Space selects it, Escape clears. The focus
 * ring is the `--focus` role token as a stroke — an SVG rect has no reliable outline. The hit
 * rects sit in their own overlay `<svg>` over the scene (same `viewBox`, same aspect fit), not
 * inside `MimicScene`'s `role="img"`: an image's children are presentational, so a button there
 * would never reach the accessibility tree.
 */
export function MimicPreviewCanvas({ entry, readings, stateMaps, selected, onSelect }: MimicPreviewCanvasProps) {
  const geometry = useMemo(() => layoutGeometry(entry.layout), [entry.layout]);
  const roled = geometry.units.filter((unit) => unit.roleCode !== null);
  const selectedUnit = selected === null ? undefined : roled.find((unit) => unit.key === selected);

  function onUnitKeyDown(event: KeyboardEvent<SVGRectElement>, key: string): void {
    if (event.key === "Enter" || event.key === " ") {
      // Space would otherwise scroll the page.
      event.preventDefault();
      onSelect(key);
    } else if (event.key === "Escape") {
      onSelect(null);
    }
  }

  return (
    <div
      data-testid="mimic-preview-canvas"
      className="surface-pressed relative w-full"
      style={{ aspectRatio: `${entry.layout.canvasW} / ${entry.layout.canvasH}` }}
    >
      <MimicScene title="Layout preview" geometry={geometry} nodes={entry.nodes} readings={readings} stateMaps={stateMaps} />
      <svg
        viewBox={geometry.viewBox}
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label="Units in the layout preview"
        className="absolute inset-0 h-full w-full"
      >
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
              role="button"
              tabIndex={0}
              aria-label={unit.label}
              aria-pressed={unit.key === selected}
              x={unit.box.x}
              y={unit.box.y}
              width={unit.box.w}
              height={unit.box.h}
              fill="none"
              pointerEvents="all"
              className="cursor-pointer outline-none focus-visible:stroke-focus focus-visible:stroke-2"
              onClick={(event) => {
                event.stopPropagation();
                onSelect(unit.key);
              }}
              onKeyDown={(event) => onUnitKeyDown(event, unit.key)}
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
      </svg>
    </div>
  );
}
