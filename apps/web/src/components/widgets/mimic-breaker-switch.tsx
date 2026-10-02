import type { BreakerState, MimicOrgSymbolDto, MimicSymbol } from "@bms/shared";

import { BREAKER_LOOK_CLASSES, type BreakerLook } from "../../lib/mimic-breaker";
import { MimicGlyph } from "./mimic-glyphs";

/** The contact, in the glyphs' 24-unit box: the two terminals, and the blade per state. */
const TERMINALS = "M12 2.5v4.5M12 17v4.5";
const BLADE_CLOSED = "M12 7v10";
const BLADE_OPEN = "M12 17 5.5 8.5";
const TRIP_CROSS = "M15 8.5l5 5M20 8.5l-5 5";

type BreakerSwitchProps = {
  readonly state: BreakerState;
  readonly look: BreakerLook;
  /** The unit's own symbol — what an `unknown` state draws, plain. */
  readonly symbol: MimicSymbol;
  readonly x: number;
  readonly y: number;
  readonly size: number;
  /** The class an `unknown` state's plain glyph draws in (the unit's panel tint). */
  readonly plainClass: string;
  readonly orgSymbol?: MimicOrgSymbolDto | null;
};

/**
 * `F3.74` Task 3.1 (plan D6) — one breaker's switch. CLOSED: a straight contact across the two
 * terminals. OPEN: the blade swung off the line. TRIPPED: swung off plus a cross. OFFLINE: the
 * contact faint and dashed — we cannot see it, which is not OPEN (ADR 0027 decision 5). UNKNOWN:
 * the unit's plain symbol, drawn as any other unit draws it.
 *
 * Colours are ADR 0078 role classes from `BREAKER_LOOK_CLASSES` only.
 */
export function BreakerSwitch({ state, look, symbol, x, y, size, plainClass, orgSymbol = null }: BreakerSwitchProps) {
  if (state === "unknown") {
    return (
      <g data-testid="mimic-breaker-switch" data-breaker-state={state}>
        <MimicGlyph kind={symbol} x={x} y={y} size={size} className={plainClass} orgSymbol={orgSymbol} />
      </g>
    );
  }
  const blade = state === "closed" || state === "offline" ? BLADE_CLOSED : BLADE_OPEN;
  return (
    <g
      data-testid="mimic-breaker-switch"
      data-breaker-state={state}
      aria-hidden="true"
      transform={`translate(${x} ${y}) scale(${size / 24})`}
      fill="none"
      strokeWidth={1.75}
      strokeLinecap="round"
      className={BREAKER_LOOK_CLASSES[look].ink}
    >
      <path d={TERMINALS} />
      <path d={blade} strokeDasharray={state === "offline" ? "2 2" : undefined} />
      {state === "tripped" ? <path d={TRIP_CROSS} /> : null}
    </g>
  );
}
