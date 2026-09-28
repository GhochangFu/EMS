import type { ReactNode } from "react";

import type { MimicGlyphKind } from "../../lib/mimic";

/**
 * `F3.32b` (ADR 0079 Amendment 2) — the plant mimic's illustrated symbols.
 *
 * The path data is copied from the `<symbol id="g-…">` set in Sheet 03 of
 * `docs/ion-exchange-nexus-dashboard-2026-08-29.html` (our own mock): `g-tank`, `g-pump`,
 * `g-clarify`, `g-aerate`, `g-dose`, `g-discharge`, `g-alert`, and `g-filter` for the softener's
 * resin vessel. The RO membrane and the cooling tower have no symbol there and are drawn here in
 * the same 24-unit grid and stroke.
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
  alert: (
    <>
      <path d="M12 3.5 21.5 20h-19z" />
      <path d="M12 10v4.5M12 17.4h.01" />
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
