import { MIMIC_LAYOUT_BOUNDS } from "@bms/shared/contracts";
import type { MimicOrgSymbolDto } from "@bms/shared";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import type { SiteLiveReadings } from "../../hooks/use-site-live-readings";
import { dragBox, pointerToGrid } from "../../lib/mimic-editor-geometry";
import type { Box, EditorAction, EditorNode, EditorState } from "../../lib/mimic-editor";
import { layoutGeometry } from "../../lib/mimic-geometry";
import { MimicScene } from "../widgets/mimic-scene";

/**
 * `F3.32c` U6b (ADR 0081 decision 7) — the editor's drawing surface: the layout drawn by the
 * dashboard's own `MimicScene` (one renderer, plan D10), with an overlay of one hit rect per node,
 * the selection outline and a bottom-right resize handle.
 *
 * **Hit rects are `fill="none"` with `pointerEvents="all"`**, never `fill="transparent"`: the
 * F3.65 colour gate refuses a named colour (R14), and `pointer-events: all` catches a pointer on
 * an unpainted rect.
 *
 * **The pointer flow is `dashboard-canvas.tsx`'s**: capture the pointer on down, turn the client
 * delta into whole cells (`pointerToGrid`, measured from this element's rect — a pure argument,
 * never a DOM read inside the geometry), dispatch `preview` on every move and one `set-box` on
 * up. The reducer makes the drag ONE history entry. **Verified only in the browser pass**: jsdom
 * implements no layout, so its rect is zero and `pointerToGrid` moves nothing.
 *
 * **Pipe mode**: the first unit clicked is the pipe's start (outlined), the second its end.
 * Panels and labels are not pipe ends (plan D7) and a click on one is ignored.
 */

export type MimicEditorCanvasProps = {
  state: EditorState;
  dispatch: (action: EditorAction) => void;
  pipeMode: boolean;
  /**
   * `F3.32f` slice 3 (ADR 0086 decision 7): the organization symbols the units may draw — the
   * stored layout's `orgSymbols` and the catalog's, which the page supplies. None by default.
   */
  orgSymbols?: readonly MimicOrgSymbolDto[];
};

const NO_ORG_SYMBOLS: readonly MimicOrgSymbolDto[] = [];

/** The editor draws no live data: every roled unit reads as "Not assigned". */
const NO_READINGS: SiteLiveReadings = {
  nowMs: 0,
  pointLatest: () => null,
  assetLastSeenMs: () => null,
};

/** The resize handle's side, in viewBox units. */
const HANDLE = 14;

type Drag = {
  readonly key: string;
  readonly origin: Box;
  readonly startX: number;
  readonly startY: number;
  readonly mode: "move" | "resize";
  last: Box;
};

function boxOf(node: EditorNode): Box {
  return { x: node.x, y: node.y, w: node.w, h: node.h };
}

export function MimicEditorCanvas({ state, dispatch, pipeMode, orgSymbols = NO_ORG_SYMBOLS }: MimicEditorCanvasProps) {
  const { layout, selected } = state;
  const { cell } = MIMIC_LAYOUT_BOUNDS;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const [pipeFrom, setPipeFrom] = useState<string | null>(null);

  useEffect(() => {
    if (!pipeMode) {
      setPipeFrom(null);
    }
  }, [pipeMode]);

  const geometry = useMemo(
    () =>
      layoutGeometry({
        name: layout.name,
        canvasW: layout.canvasW,
        canvasH: layout.canvasH,
        nodes: [...layout.nodes],
        pipes: [...layout.pipes],
        orgSymbols: [...orgSymbols],
      }),
    [layout, orgSymbols],
  );

  /** Nodes in drawing order, so a unit's hit rect sits above its panel's. */
  const ordered = useMemo(
    () =>
      layout.nodes
        .map((node, i) => ({ node, i }))
        .sort((a, b) => a.node.z - b.node.z || a.i - b.i)
        .map(({ node }) => node),
    [layout.nodes],
  );

  function clickInPipeMode(node: EditorNode): void {
    if (node.kind !== "unit") {
      return;
    }
    if (pipeFrom === null || pipeFrom === node.key) {
      setPipeFrom(pipeFrom === node.key ? null : node.key);
      return;
    }
    dispatch({ type: "add-pipe", fromKey: pipeFrom, toKey: node.key });
    setPipeFrom(null);
  }

  function beginDrag(node: EditorNode, mode: "move" | "resize", event: ReactPointerEvent<SVGRectElement>): void {
    event.stopPropagation();
    if (pipeMode) {
      clickInPipeMode(node);
      return;
    }
    dispatch({ type: "select", key: node.key });
    const target = event.currentTarget;
    if (typeof target.setPointerCapture === "function") {
      target.setPointerCapture(event.pointerId);
    }
    const origin = boxOf(node);
    drag.current = { key: node.key, origin, startX: event.clientX, startY: event.clientY, mode, last: origin };
  }

  function onPointerMove(event: ReactPointerEvent<SVGRectElement>): void {
    const current = drag.current;
    if (current === null) {
      return;
    }
    const rect = containerRef.current?.getBoundingClientRect() ?? { width: 0, height: 0 };
    const cells = pointerToGrid(
      { dx: event.clientX - current.startX, dy: event.clientY - current.startY },
      rect,
      layout.canvasW,
      layout.canvasH,
    );
    const next = dragBox(current.origin, cells, current.mode);
    if (next.x !== current.last.x || next.y !== current.last.y || next.w !== current.last.w || next.h !== current.last.h) {
      current.last = next;
      dispatch({ type: "preview", key: current.key, box: next });
    }
  }

  function endDrag(): void {
    const current = drag.current;
    drag.current = null;
    if (current !== null) {
      dispatch({ type: "set-box", key: current.key, box: current.last });
    }
  }

  /** A cancelled drag (the browser took the pointer) keeps nothing: a `set-box` at the drag's
   * origin restores the pre-drag layout and pushes no history (the reducer's no-movement arm). */
  function cancelDrag(): void {
    const current = drag.current;
    drag.current = null;
    if (current !== null) {
      dispatch({ type: "set-box", key: current.key, box: current.origin });
    }
  }

  const selectedNode = selected === null ? undefined : layout.nodes.find((n) => n.key === selected);
  const pipeStart = pipeFrom === null ? undefined : layout.nodes.find((n) => n.key === pipeFrom);

  return (
    <div
      ref={containerRef}
      data-testid="mimic-editor-canvas"
      data-pipe-mode={pipeMode ? "true" : "false"}
      className="surface-pressed relative w-full"
      style={{ aspectRatio: `${layout.canvasW} / ${layout.canvasH}` }}
    >
      <MimicScene title="Layout editor" geometry={geometry} nodes={[]} readings={NO_READINGS}>
        <g data-testid="mimic-editor-overlay">
          <rect
            data-testid="mimic-editor-background"
            x={0}
            y={0}
            width={geometry.width}
            height={geometry.height}
            fill="none"
            pointerEvents="all"
            onPointerDown={() => {
              if (!pipeMode) {
                dispatch({ type: "select", key: null });
              }
            }}
          />
          {ordered.map((node) => (
            <rect
              key={node.key}
              data-testid="mimic-editor-hit"
              data-node-key={node.key}
              data-node-kind={node.kind}
              x={node.x * cell}
              y={node.y * cell}
              width={node.w * cell}
              height={node.h * cell}
              fill="none"
              pointerEvents="all"
              className={pipeMode && node.kind === "unit" ? "cursor-crosshair" : "cursor-move"}
              onPointerDown={(event) => beginDrag(node, "move", event)}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={cancelDrag}
            />
          ))}
          {pipeStart !== undefined ? (
            <rect
              data-testid="mimic-editor-pipe-start"
              x={pipeStart.x * cell}
              y={pipeStart.y * cell}
              width={pipeStart.w * cell}
              height={pipeStart.h * cell}
              fill="none"
              strokeWidth={3}
              strokeDasharray="8 4"
              pointerEvents="none"
              className="stroke-info"
            />
          ) : null}
          {selectedNode !== undefined ? (
            <>
              <rect
                data-testid="mimic-editor-selection"
                data-node-key={selectedNode.key}
                x={selectedNode.x * cell}
                y={selectedNode.y * cell}
                width={selectedNode.w * cell}
                height={selectedNode.h * cell}
                fill="none"
                strokeWidth={2}
                pointerEvents="none"
                className="stroke-accent"
              />
              {!pipeMode ? (
                <rect
                  data-testid="mimic-editor-resize"
                  x={(selectedNode.x + selectedNode.w) * cell - HANDLE}
                  y={(selectedNode.y + selectedNode.h) * cell - HANDLE}
                  width={HANDLE}
                  height={HANDLE}
                  pointerEvents="all"
                  className="cursor-se-resize fill-accent"
                  onPointerDown={(event) => beginDrag(selectedNode, "resize", event)}
                  onPointerMove={onPointerMove}
                  onPointerUp={endDrag}
                  onPointerCancel={cancelDrag}
                />
              ) : null}
            </>
          ) : null}
        </g>
      </MimicScene>
    </div>
  );
}
