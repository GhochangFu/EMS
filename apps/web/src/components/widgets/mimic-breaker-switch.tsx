import type { BreakerState, MimicOrgSymbolDto, MimicSymbol } from "@bms/shared";

import { mimicCalloutText } from "../../lib/mimic";
import {
  BREAKER_LOOK_CLASSES,
  FANOUT_BAND,
  type BreakerLook,
  type FanOutMemberRow,
  type FanOutRow,
} from "../../lib/mimic-breaker";
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

type FanOutMembersProps = {
  readonly members: readonly FanOutMemberRow[];
  readonly places: readonly FanOutRow[];
  readonly more: number;
  readonly symbol: MimicSymbol;
  readonly plainClass: string;
};

/**
 * `F3.74` Task 3.1 (ADR 0088 decision 4, OQ6) — a fan-out unit's members, stacked under its frame
 * in the response's (asset-code) order: code · switch · pill, one column up to eight, two up to
 * sixteen, then "+N more".
 */
export function FanOutMembers({ members, places, more, symbol, plainClass }: FanOutMembersProps) {
  const { rowH } = FANOUT_BAND;
  return (
    <g data-testid="mimic-fanout">
      {places.map((place, i) => {
        const member = members[i];
        if (member === undefined) {
          return null;
        }
        const wide = place.w >= 150;
        return (
          <g
            key={member.id}
            data-testid="mimic-breaker-member"
            data-asset-code={member.code}
            data-breaker-state={member.state ?? undefined}
            data-frame={member.frame}
            transform={`translate(${place.x} ${place.y})`}
          >
            <title>{`${member.code}: ${member.text}`}</title>
            <rect
              x={1}
              y={0}
              width={place.w - 2}
              height={rowH - 1}
              rx={3}
              strokeWidth={1}
              strokeDasharray={member.dashed ? "3 2" : undefined}
              className={`fill-surface ${member.frameClass}`}
            />
            <text x={4} y={8.5} fontSize={wide ? 9 : 8} fontWeight={700} className="fill-ink">
              {mimicCalloutText(member.code, wide ? 18 : 9)}
            </text>
            {member.state === null || member.look === null ? null : (
              <BreakerSwitch
                state={member.state}
                look={member.look}
                symbol={symbol}
                x={place.w * 0.58 - 5}
                y={0.5}
                size={10}
                plainClass={plainClass}
              />
            )}
            <text
              data-testid={member.state === null ? "mimic-member-status" : "mimic-breaker-pill"}
              x={place.w - 4}
              y={8.5}
              textAnchor="end"
              fontSize={7.5}
              fontWeight={700}
              className={member.textClass}
            >
              {member.text}
            </text>
          </g>
        );
      })}
      {more > 0 ? (
        <text
          data-testid="mimic-fanout-more"
          x={4}
          y={FANOUT_BAND.top + FANOUT_BAND.perColumn * rowH + 10}
          fontSize={10}
          fontWeight={700}
          className="fill-ink-muted"
        >
          {`+${more} more`}
        </text>
      ) : null}
    </g>
  );
}
