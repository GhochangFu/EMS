import { useId } from "react";

import { PRODUCT_NAME } from "../lib/brand";
import { VERVE_LOGO, type VerveLogoTone } from "./verve-logo-data";

/**
 * `F4.398` (ADR 0142 decisions 2 and 3, Amendment 1) — the Verve logo as inline SVG: the pulse V,
 * one filled shape with one gradient from foot to peak, then the letters "erve" as one outline
 * path. Drawing and colours come from `verve-logo-data.ts`; they are fixed brand colours, not ADR
 * 0078 roles, so no theme or colour profile moves them (a themed logo is `F4.399`).
 *
 * `tone` is the form for the surface the logo sits on: `dark` (the default) on a dark surface,
 * `light` on a light one. Every call site today sits on `chrome`, which is dark in every theme and
 * profile. The gradient id comes from `useId`, so two logos in one document never share one.
 *
 * In a header the logo is lifted by 21 % of its own height. The tall peak of the pulse puts the
 * letters' centre that far below the centre of the logo's box, so a logo centred by its box showed
 * "erve" about 7 px below the header text beside it (owner, 2026-11-22). The lift puts the letters
 * on the header's centre line and lets the peak rise above it. `rail` is the 40 px rail header: a
 * lifted `h-8` would put the peak above the header, so it takes `h-7`. The hero is not lifted.
 *
 * `animated` (Amendment 2, the login page only) adds motion without changing the drawing: a clip
 * that draws the pulse from left to right once, the letters fading in behind it, and then a soft
 * light that crosses the pulse every 6 s — a masked, lighter copy of the same pulse path. The
 * pulse keeps its one fill and one gradient. The three classes are plain CSS in `index.css`,
 * inside `prefers-reduced-motion: no-preference`, so with reduced motion the logo is the static
 * one. The light's colour is the logo's own white from the data file: no thirteenth colour.
 */
const SIZES = {
  header: "h-8 w-auto -translate-y-[21%]",
  rail: "h-7 w-auto -translate-y-[21%]",
  hero: "h-28 w-auto sm:h-36",
} as const;

/** The pulse ends at x ≈ 232 of the 455-wide drawing; the clip and the light cover that span. */
const PULSE_SPAN = 240;
const LIGHT_WIDTH = 70;

/** The product logo, announced once as "Verve"; `header`, `rail` or `hero` size. */
export function Wordmark({
  variant,
  tone = "dark",
  animated = false,
}: {
  variant: keyof typeof SIZES;
  tone?: VerveLogoTone;
  animated?: boolean;
}) {
  const id = `verve-pulse-${useId().replace(/[^\w-]/g, "")}`;
  const { gradient, tones } = VERVE_LOGO;
  const [, , , boxHeight] = VERVE_LOGO.viewBox.split(" ").map(Number);
  const light = tones.dark.letters;
  const pulse = <path data-part="pulse" d={VERVE_LOGO.pulse} fill={`url(#${id})`} />;
  return (
    <svg role="img" aria-label={PRODUCT_NAME} viewBox={VERVE_LOGO.viewBox} focusable="false" className={SIZES[variant]}>
      <defs>
        <linearGradient
          id={id}
          gradientUnits="userSpaceOnUse"
          x1={gradient.x1}
          y1={gradient.y1}
          x2={gradient.x2}
          y2={gradient.y2}
        >
          {tones[tone].stops.map((stop) => (
            <stop key={stop.offset} offset={stop.offset} stopColor={stop.color} />
          ))}
        </linearGradient>
        {animated ? (
          <>
            <clipPath id={`${id}-reveal`}>
              <rect className="verve-logo-reveal" x={0} y={0} width={PULSE_SPAN} height={boxHeight} />
            </clipPath>
            <linearGradient id={`${id}-soft`} x1={0} y1={0} x2={1} y2={0}>
              <stop offset={0} stopColor={light} stopOpacity={0} />
              <stop offset={0.5} stopColor={light} stopOpacity={1} />
              <stop offset={1} stopColor={light} stopOpacity={0} />
            </linearGradient>
            <mask id={`${id}-light`} maskUnits="userSpaceOnUse" x={0} y={0} width={PULSE_SPAN} height={boxHeight}>
              <rect
                className="verve-logo-light"
                x={-LIGHT_WIDTH}
                y={0}
                width={LIGHT_WIDTH}
                height={boxHeight}
                fill={`url(#${id}-soft)`}
              />
            </mask>
          </>
        ) : null}
      </defs>
      {animated ? (
        <>
          <g clipPath={`url(#${id}-reveal)`}>{pulse}</g>
          <path data-part="light" d={VERVE_LOGO.pulse} fill={light} opacity={0.85} mask={`url(#${id}-light)`} />
        </>
      ) : (
        pulse
      )}
      <path
        data-part="letters"
        className={animated ? "verve-logo-letters" : undefined}
        d={VERVE_LOGO.letters}
        fill={tones[tone].letters}
        fillRule="evenodd"
      />
    </svg>
  );
}
