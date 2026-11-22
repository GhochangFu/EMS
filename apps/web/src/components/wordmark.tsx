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
 */
const SIZES = {
  header: "h-8 w-auto",
  hero: "h-28 w-auto sm:h-36",
} as const;

/** The product logo, announced once as "Verve"; `header` or `hero` size. */
export function Wordmark({ variant, tone = "dark" }: { variant: keyof typeof SIZES; tone?: VerveLogoTone }) {
  const id = `verve-pulse-${useId().replace(/[^\w-]/g, "")}`;
  const { gradient, tones } = VERVE_LOGO;
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
      </defs>
      <path data-part="pulse" d={VERVE_LOGO.pulse} fill={`url(#${id})`} />
      <path data-part="letters" d={VERVE_LOGO.letters} fill={tones[tone].letters} fillRule="evenodd" />
    </svg>
  );
}
