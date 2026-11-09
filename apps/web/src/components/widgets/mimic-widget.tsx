import { useCallback, useEffect, useRef, useState } from "react";

import type { MimicNodeDto, PointKeyStateMapDto } from "@bms/shared";
import type { MimicGlyphSet } from "@bms/shared/contracts";

import type { SiteLiveReadings } from "../../hooks/use-site-live-readings";
import type { MimicGeometry } from "../../lib/mimic-geometry";
import type { WidgetStatus } from "../../lib/widget-catalog";
import { MimicExpandDialog } from "./mimic-expand-dialog";
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
  /** `F3.74` — the read's state maps; none where there is no read (`DashboardWidget`). */
  stateMaps?: readonly PointKeyStateMapDto[];
  /** `F3.74` OQ9 — a preset config's `compact`. */
  compact?: boolean;
  /**
   * `F4.321` — draw an Expand button that opens the drawing in a full-view dialog. Only the live
   * widget (`MimicWidgetLive`) passes it; the static `DashboardWidget` branch does not.
   */
  expandable?: boolean;
  /**
   * `F4.344` (ADR 0120 decision 6) — animate each unit's glyph by its state, on the tile and in the
   * Expand dialog alike. Off by default; only `MimicWidgetLive` turns it on.
   */
  motion?: boolean;
  /** `F4.345` (ADR 0121 decision 5) — the widget's glyph set, on the tile and in the Expand dialog alike. */
  glyphSet?: MimicGlyphSet;
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
 *
 * **`F4.321` — Expand.** With `expandable`, a ready tile draws an Expand button in its title row
 * that opens `MimicExpandDialog`: a second `MimicScene` with the same props, so the live overlay
 * moves both drawings at once and nothing is read twice. The dialog drops `compact` (owner Q1). On
 * the wall the click is a `pointerdown`, which pauses the tab rotation, so a turn does not unmount
 * the open dialog. Closing returns focus to Expand.
 */
export function MimicWidget({
  title,
  status,
  geometry,
  nodes,
  readings,
  stateMaps,
  compact,
  expandable = false,
  motion = false,
  glyphSet,
}: MimicWidgetProps) {
  const [open, setOpen] = useState(false);
  const expandRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    expandRef.current?.focus();
  }, []);
  // `F4.321` — only a ready tile with something to draw offers the full view.
  const canExpand = expandable && status === "ready" && geometry.width > 0 && geometry.height > 0;
  // Review finding: a refetch that takes the drawing away unmounts the dialog; `open` must go with
  // it, or the dialog would come back on its own when the drawing returns.
  useEffect(() => {
    if (!canExpand) setOpen(false);
  }, [canExpand]);

  return (
    <WidgetFrame
      title={title}
      status={status}
      actions={
        canExpand ? (
          <button
            ref={expandRef}
            type="button"
            aria-label={`Expand ${title}`}
            aria-haspopup="dialog"
            onClick={() => setOpen(true)}
            className="shrink-0 surface-button px-2 py-0.5 text-3xs font-semibold uppercase tracking-wide"
          >
            Expand
          </button>
        ) : null
      }
    >
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0">
          <MimicScene
            title={title}
            geometry={geometry}
            nodes={nodes}
            readings={readings}
            stateMaps={stateMaps}
            compact={compact}
            motion={motion}
            glyphSet={glyphSet}
          />
        </div>
      </div>
      {canExpand && open ? (
        // Owner Q1 (2026-11-07): the full view draws the value rows even for a `compact` tile.
        <MimicExpandDialog title={title} onClose={close}>
          <MimicScene
            title={title}
            geometry={geometry}
            nodes={nodes}
            readings={readings}
            stateMaps={stateMaps}
            motion={motion}
            glyphSet={glyphSet}
          />
        </MimicExpandDialog>
      ) : null}
    </WidgetFrame>
  );
}
