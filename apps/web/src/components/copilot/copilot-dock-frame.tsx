import type { KeyboardEvent, PointerEvent, ReactNode, Ref } from "react";
import { useRef } from "react";

import {
  clampCopilotSize,
  COPILOT_MIN_WIDTH,
  COPILOT_MIN_HEIGHT,
  dockedBounds,
  floatingBounds,
  resizedSize,
  steppedSize,
  type CopilotEdge,
  type CopilotSize,
  type CopilotViewport,
} from "../../lib/copilot-window";
import type { CopilotWindowMode } from "../../stores/copilot-window-store";
import { useViewportSize } from "./use-copilot-viewport";

/**
 * `F4.292` (ADR 0099 Amendment 9 E6; owner ruling P6) — the copilot panel's
 * window: the `<aside id="copilot-panel">` in one of four shapes, its header
 * bar with the mode buttons and Close, and the resize handles.
 *
 * - **floating** — above the button at the bottom right, sized by the stored
 *   size, resized from the left and top edges (min 360 × 420, max the viewport
 *   less the 48 × 128 px it leaves, so the stored size is the drawn size).
 * - **maximized** — 90 vw × 90 vh, centred; no handle.
 * - **docked** — full height at the right; `AppShell` pads the page by the same
 *   width, so the page is pushed, not covered. The width is the stored width
 *   (ruling P6), resized from the left edge, and never more than the viewport
 *   less the page's minimum.
 * - **sheet** — under 768 px, whatever the mode: full screen, no handle and no
 *   mode buttons.
 *
 * A handle is a focusable `separator`; the arrow keys step it 16 px (ruling P6).
 *
 * **Chats** (E7). The maximized panel shows the conversation list as a left
 * column (`w-64`); every other shape shows it as a drawer over the body,
 * opened by the header's *Chats* button. Docked takes the drawer too (critic:
 * at the stored 360–380 px a column would leave the thread about 110 px).
 * The size shown is clamped against the current viewport at render time.
 * Surfaces keep the theme tokens (`surface-raised`, `bg-chrome`, `border-line`).
 */

const MODE_BUTTONS: readonly { mode: CopilotWindowMode; label: string; icon: ReactNode }[] = [
  { mode: "floating", label: "Float", icon: <rect x="12" y="11" width="9" height="9" rx="1" /> },
  { mode: "maximized", label: "Maximize", icon: <rect x="3" y="3" width="18" height="18" rx="1" /> },
  {
    mode: "docked",
    label: "Dock to the side",
    icon: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="1" />
        <path d="M14 3v18" />
      </>
    ),
  },
];

// The maximized 90 vw × 90 vh, centred, is the E6 ruling's size (ADR 0099 Amendment 9).
const SHAPE: Record<CopilotWindowMode | "sheet", string> = {
  sheet: "fixed inset-0 z-50",
  floating: "fixed bottom-28 right-6 z-50 rounded-lg",
  maximized: "fixed left-[5vw] top-[5vh] z-50 h-[90vh] w-[90vw] rounded-lg",
  docked: "fixed right-0 top-0 z-40 h-screen border-l border-line",
};

type ResizeStart = CopilotSize & { x: number; y: number; pointerId: number };

function ResizeHandle({
  edge,
  size,
  bounds,
  onResize,
}: {
  edge: CopilotEdge;
  size: CopilotSize;
  bounds: CopilotViewport;
  onResize: (size: CopilotSize) => void;
}) {
  const start = useRef<ResizeStart | null>(null);
  const edges = { left: edge === "left", top: edge === "top" };

  function onPointerDown(e: PointerEvent<HTMLDivElement>): void {
    e.preventDefault();
    start.current = { ...size, x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>): void {
    if (start.current === null) return;
    onResize(resizedSize(start.current, { x: e.clientX, y: e.clientY }, edges, bounds));
  }
  function onPointerEnd(e: PointerEvent<HTMLDivElement>): void {
    if (start.current === null) return;
    start.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    const next = steppedSize(size, edge, e.key, bounds);
    if (next === null) return;
    e.preventDefault();
    onResize(next);
  }

  return (
    <div
      role="separator"
      aria-orientation={edge === "left" ? "vertical" : "horizontal"}
      aria-label={`Resize the copilot panel: ${edge} edge`}
      aria-valuenow={edge === "left" ? size.width : size.height}
      aria-valuemin={edge === "left" ? COPILOT_MIN_WIDTH : COPILOT_MIN_HEIGHT}
      aria-valuemax={Math.max(edge === "left" ? COPILOT_MIN_WIDTH : COPILOT_MIN_HEIGHT, edge === "left" ? bounds.width : bounds.height)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onKeyDown={onKeyDown}
      className={`absolute left-0 top-0 z-10 touch-none hover:bg-accent/40 focus:outline-none focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-accent ${
        edge === "left" ? "h-full w-1.5 cursor-ew-resize" : "h-1.5 w-full cursor-ns-resize"
      }`}
    />
  );
}

export type CopilotDockFrameProps = {
  mode: CopilotWindowMode;
  size: CopilotSize;
  sheet: boolean;
  onModeChange: (mode: CopilotWindowMode) => void;
  /** A size from a drag or an arrow key, already clamped to this mode's bounds. */
  onResize: (size: CopilotSize, bounds: CopilotViewport) => void;
  onClose: () => void;
  /** The `<aside>`, focusable (`tabIndex={-1}`): the dock moves the focus here when its button unmounts. */
  panelRef?: Ref<HTMLElement>;
  /** The left side of the header bar: the title and the scope line. */
  header: ReactNode;
  /** `F4.292`: the conversation list, and whether its drawer is open (the column ignores it). */
  chats?: { list: ReactNode; open: boolean; onToggle: () => void };
  children: ReactNode;
};

export function CopilotDockFrame({
  mode,
  size,
  sheet,
  onModeChange,
  onResize,
  onClose,
  panelRef,
  header,
  chats,
  children,
}: CopilotDockFrameProps) {
  const viewport = useViewportSize();
  const shape = sheet ? "sheet" : mode;
  const bounds = mode === "docked" ? dockedBounds(viewport) : floatingBounds(viewport);
  const shown = clampCopilotSize(size, bounds);
  const style =
    shape === "floating"
      ? { width: shown.width, height: shown.height, maxWidth: "calc(100vw - 3rem)", maxHeight: "calc(100vh - 8rem)" }
      : shape === "docked"
        ? { width: shown.width }
        : undefined;
  const resize = (next: CopilotSize): void => onResize(next, bounds);
  const column = shape === "maximized";

  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      id="copilot-panel"
      aria-label="Copilot"
      data-mode={shape}
      style={style}
      className={`surface-raised flex flex-col overflow-hidden focus:outline-none ${SHAPE[shape]}`}
    >
      {(shape === "floating" || shape === "docked") && (
        <ResizeHandle edge="left" size={shown} bounds={bounds} onResize={resize} />
      )}
      {shape === "floating" && <ResizeHandle edge="top" size={shown} bounds={bounds} onResize={resize} />}
      <header className="flex items-start justify-between gap-2 border-b border-line bg-chrome px-4 py-3 text-on-dark">
        {header}
        <div className="flex shrink-0 items-center gap-1">
          {chats !== undefined && !column && (
            <button
              type="button"
              aria-expanded={chats.open}
              aria-controls={chats.open ? "copilot-chats" : undefined}
              onClick={chats.onToggle}
              className={`rounded px-2 py-0.5 text-xs hover:text-on-dark ${chats.open ? "bg-on-dark/15 text-on-dark" : "text-on-dark/70"}`}
            >
              Chats
            </button>
          )}
          {!sheet && (
            <div role="group" aria-label="Copilot window mode" className="flex items-center gap-0.5">
              {MODE_BUTTONS.map((b) => (
                <button
                  key={b.mode}
                  type="button"
                  aria-label={b.label}
                  title={b.label}
                  aria-pressed={mode === b.mode}
                  onClick={() => onModeChange(b.mode)}
                  className={`grid h-6 w-6 place-items-center rounded hover:text-on-dark ${
                    mode === b.mode ? "bg-on-dark/15 text-on-dark" : "text-on-dark/70"
                  }`}
                >
                  <svg
                    aria-hidden="true"
                    width={14}
                    height={14}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    {b.icon}
                  </svg>
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            aria-label="Close the copilot panel"
            onClick={onClose}
            className="rounded px-2 text-on-dark/70 hover:text-on-dark"
          >
            ×
          </button>
        </div>
      </header>
      <div className="relative flex min-h-0 flex-1">
        {chats !== undefined && (column || chats.open) && (
          <div
            id="copilot-chats"
            className={`flex flex-col bg-canvas ${column ? "w-64 shrink-0 border-r border-line" : "absolute inset-0 z-20"}`}
          >
            {chats.list}
          </div>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </aside>
  );
}
