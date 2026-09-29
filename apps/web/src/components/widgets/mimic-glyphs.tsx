import type { ReactNode } from "react";

import type { MimicGlyphKind } from "../../lib/mimic";

/**
 * `F3.32b` (ADR 0079 Amendment 2) — the plant mimic's illustrated symbols.
 *
 * The path data is copied from the `<symbol id="g-…">` set in Sheet 03 of
 * `docs/ion-exchange-nexus-dashboard-2026-08-29.html` (our own mock): `g-tank`, `g-pump`,
 * `g-clarify`, `g-aerate`, `g-dose`, `g-discharge`, `g-alert`, and `g-filter` for the softener's
 * resin vessel. The RO membrane and the cooling tower have no symbol there and are drawn here in
 * the same 24-unit grid and stroke, as are `F3.32c`'s layout-only `valve`, `filter` and the
 * generic `unit` (ADR 0081, plan D12). `F3.32d` (ADR 0082) appends seventeen glyphs for the
 * electrical, HVAC/water-adjacent, UPS/battery, environmental and lift domains (`transformer`
 * through `lift`) — drawn fresh, by the plan's glyph brief, in the same grid and stroke. `PATHS`
 * is keyed by `MimicGlyphKind`, so a symbol the shared contract adds without a path here is a
 * compile error.
 *
 * Paths are inlined, never `<symbol>`/`<use>`: two mimics on one dashboard must not share an id.
 * The stroke colour is the caller's role class on the wrapping `<g>` — the paths inherit it, so
 * this file names no colour at all (`tests/f3.65-colour-roles-gate.test.ts`).
 */

const PATHS: Readonly<Record<MimicGlyphKind, ReactNode>> = {
  tank: (
    <>
      <path d="M4 6.5v11c0 1.9 3.6 3.5 8 3.5s8-1.6 8-3.5v-11" />
      <ellipse cx="12" cy="6.5" rx="8" ry="3.5" />
    </>
  ),
  clarifier: (
    <>
      <path d="M2.5 5h19l-8 14h-3z" />
      <path d="M6 10h12" />
    </>
  ),
  membrane: (
    <>
      <rect x="2.5" y="7.5" width="19" height="8" rx="4" />
      <path d="M6.5 10.5h11M6.5 12.5h11" />
      <path d="M12 15.5v4M8.5 19.5h7" />
    </>
  ),
  vessel: (
    <>
      <rect x="6" y="3" width="12" height="18" rx="5" />
      <path d="M9.5 9.5h.01M14 9h.01M11.5 13h.01M15 15h.01M9 16h.01" />
    </>
  ),
  tower: (
    <>
      <path d="M7 20.5c1.2-3.5 1.2-7.5-.5-11h11c-1.7 3.5-1.7 7.5-.5 11z" />
      <path d="M4.5 20.5h15" />
      <path d="M10 7.5c-.8-1 .8-2 0-3.5M14 7.5c-.8-1 .8-2 0-3.5" />
    </>
  ),
  aeration: (
    <>
      <path d="M3.5 7v11c0 1 .8 1.8 1.8 1.8h13.4c1 0 1.8-.8 1.8-1.8V7" />
      <circle cx="8.5" cy="14" r="1.6" />
      <circle cx="13.5" cy="11" r="1.9" />
      <circle cx="17" cy="15" r="1.3" />
    </>
  ),
  dosing: (
    <>
      <path d="M12 3.5s5 6 5 9.5a5 5 0 0 1-10 0c0-3.5 5-9.5 5-9.5z" />
      <path d="M9.5 13.5c0 1.6 1.1 2.7 2.5 2.9" />
    </>
  ),
  pump: (
    <>
      <circle cx="11" cy="13" r="6.5" />
      <path d="M11 6.5V2.5h6" />
      <path d="m8.8 15.5 4.4-5 .9 5z" />
    </>
  ),
  discharge: (
    <>
      <path d="M3 7h9a4 4 0 0 1 4 4v3" />
      <path d="m12.5 10.5 3.5 4 3.5-4" />
      <path d="M4 18h16" />
    </>
  ),
  valve: (
    <>
      <path d="M3.5 8.5v7l8.5-3.5zM20.5 8.5v7L12 12z" />
      <path d="M12 12V6M9 6h6" />
    </>
  ),
  filter: (
    <>
      <rect x="5.5" y="3" width="13" height="18" rx="2.5" />
      <path d="M5.5 9h13M5.5 15h13" />
      <path d="M9 12h.01M12 12h.01M15 12h.01" />
    </>
  ),
  unit: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
      <path d="M3.5 10h17" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3.5 21.5 20h-19z" />
      <path d="M12 10v4.5M12 17.4h.01" />
    </>
  ),
  // ADR 0082 — the seventeen glyphs for the other asset domains (`transformer` through `lift`).
  transformer: (
    <>
      <circle cx="9" cy="10" r="5.5" />
      <circle cx="15" cy="14" r="5.5" />
      <path d="M9 4.5v-2M15 19.5v2" />
    </>
  ),
  breaker: (
    <>
      <rect x="5" y="5" width="14" height="14" />
      <path d="M8 16 16 8" />
      <path d="M12 2.5v2.5M12 19v2.5" />
    </>
  ),
  switchboard: (
    <>
      <rect x="6" y="2.5" width="12" height="19" rx="1.5" />
      <path d="M9.5 7h.01M14.5 7h.01M9.5 12h.01M14.5 12h.01M9.5 17h.01M14.5 17h.01" />
    </>
  ),
  generator: (
    <>
      <circle cx="12" cy="11" r="7" />
      <path d="M15.2 8.3a4.2 4.2 0 1 0 0 7.4M15.6 11.6h-2.3" />
      <path d="M6 21h12" />
    </>
  ),
  meter: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M7.5 15a6 6 0 0 1 9 0" />
      <path d="M12 15 15 10" />
      <path d="M12 15h.01" />
    </>
  ),
  motor: (
    <>
      <circle cx="11" cy="12" r="7.5" />
      <polyline points="7,15 7,9 11,14 15,9 15,15" />
      <path d="M18.5 12h3.5" />
    </>
  ),
  ups: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <polyline points="13,6 8,13 11.5,13 10,18 16,10 12.5,10" />
      <path d="M8 19h8" />
    </>
  ),
  battery: (
    <>
      <rect x="4" y="7" width="15" height="10" rx="1.5" />
      <path d="M19 10v4" />
      <path d="M8 9.5v5M12 9.5v5" />
    </>
  ),
  rack: (
    <>
      <rect x="6" y="2.5" width="12" height="19" rx="1" />
      <path d="M6 6.5h12M6 10.5h12M6 14.5h12M6 18.5h12" />
    </>
  ),
  chiller: (
    <>
      <rect x="3" y="6" width="12" height="12" rx="1.5" />
      <path d="M5 9l2 2 2-2 2 2 2-2" />
      <path d="M19 6v12M15.5 12h7M16.5 8.5l5 7M21.5 8.5l-5 7" />
    </>
  ),
  ahu: (
    <>
      <rect x="2.5" y="4" width="19" height="16" rx="1.5" />
      <path d="M12 4v16" />
      <circle cx="7.5" cy="12" r="3.5" />
      <path d="M7.5 8.5v7M4.3 9.7l6.4 4.6M4.3 14.3l6.4-4.6" />
      <path d="M14.5 8h5M14.5 12h5M14.5 16h5" />
    </>
  ),
  fan: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 12c1-4 4-6 7-5" />
      <path d="M12 12c-4-1-6-4-5-7" />
      <path d="M12 12c-1 4-4 6-7 5" />
      <path d="M12 12h.01" />
    </>
  ),
  compressor: (
    <>
      <rect x="3" y="8" width="12" height="8" rx="4" />
      <path d="M15 12h4M19 9v6" />
    </>
  ),
  boiler: (
    <>
      <rect x="6" y="5" width="12" height="16" rx="6" />
      <path d="M9.5 16a3 3 0 0 0 5 0" />
      <path d="M15 5v-2.5" />
    </>
  ),
  sensor: (
    <>
      <path d="M12 21v-4" />
      <path d="M12 15h.01" />
      <path d="M8.8 11.5a5 5 0 0 1 6.4 0" />
      <path d="M6.5 8.3a9 9 0 0 1 11 0" />
    </>
  ),
  lamp: (
    <>
      <circle cx="12" cy="9" r="6" />
      <path d="M9.5 15h5M10 18h4" />
      <path d="M4 4l2 2M20 4l-2 2" />
    </>
  ),
  lift: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M9 15V7M9 7l-2.5 2.5M9 7l2.5 2.5" />
      <path d="M16 9v8M16 17l-2.5-2.5M16 17l2.5-2.5" />
    </>
  ),
};

/** The liquid inside `tank`, from `top` down to the curved floor, in the same 24-unit grid. */
function tankFillPath(fraction: number): string {
  const top = 18 - fraction * 11;
  return `M4.75 ${top} H19.25 V17.5 c0 1.5 -3.2 2.8 -7.25 2.8 s-7.25 -1.3 -7.25 -2.8 Z`;
}

type MimicGlyphProps = {
  kind: MimicGlyphKind;
  /** Top-left corner and edge length of the square the symbol fills, in viewBox units. */
  x: number;
  y: number;
  size: number;
  /** A stroke role class (`stroke-info`); the paths inherit it. */
  className: string;
  /** A tank's live fill, 0–1; `null` draws the tank empty. Ignored for any other kind. */
  level?: number | null;
};

/** One illustrated unit symbol, scaled into a `size` square at (`x`, `y`) in viewBox units. */
export function MimicGlyph({ kind, x, y, size, className, level = null }: MimicGlyphProps) {
  return (
    <g
      data-testid="mimic-glyph"
      data-glyph={kind}
      aria-hidden="true"
      transform={`translate(${x} ${y}) scale(${size / 24})`}
      fill="none"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {kind === "tank" && level !== null ? (
        <path
          data-testid="mimic-tank-level"
          data-level={Math.round(level * 100)}
          d={tankFillPath(level)}
          stroke="none"
          className="fill-info/30"
        />
      ) : null}
      {PATHS[kind]}
    </g>
  );
}
