import type { MimicSymbol } from "@bms/shared";

import { mimicMiddleCut } from "../../lib/mimic";
import { FANOUT_BAND, fanOutSwitchX, type FanOutMemberRow, type FanOutRow } from "../../lib/mimic-breaker";
import { BreakerSwitch } from "./mimic-breaker-switch";

type FanOutMembersProps = {
  readonly members: readonly FanOutMemberRow[];
  readonly places: readonly FanOutRow[];
  readonly more: number;
  readonly symbol: MimicSymbol;
  readonly plainClass: string;
};

/**
 * `F3.74` Task 3.1 (ADR 0088 decision 4, OQ6) — a fan-out unit's members, stacked under its frame
 * in the response's (asset-code) order: code · switch · pill for a member that carries a state,
 * else code · status; one column up to eight, two up to sixteen, then "+N more". The rows are
 * decided in `unitBreakerDrawing` (`lib/mimic-breaker.ts`); this component only draws them.
 *
 * `F4.322` — each row carries its sizes (`place.size`: `roomy` up to four members, else `dense`),
 * the code is cut in the middle so its tail shows, and the switch sits from the right
 * (`fanOutSwitchX`).
 */
export function FanOutMembers({ members, places, more, symbol, plainClass }: FanOutMembersProps) {
  return (
    <g data-testid="mimic-fanout">
      {places.map((place, i) => {
        const member = members[i];
        if (member === undefined) {
          return null;
        }
        const wide = place.w >= 150;
        const { size } = place;
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
              height={size.rowH - 1}
              rx={3}
              strokeWidth={1}
              strokeDasharray={member.dashed ? "3 2" : undefined}
              className={`fill-surface ${member.frameClass}`}
            />
            <text
              data-testid="mimic-member-code"
              x={4}
              y={size.baseline}
              fontSize={wide ? size.codeWide : size.codeNarrow}
              fontWeight={700}
              className="fill-ink"
            >
              {mimicMiddleCut(member.code, wide ? size.charsWide : size.charsNarrow)}
            </text>
            {member.state === null || member.look === null ? null : (
              <BreakerSwitch
                state={member.state}
                look={member.look}
                symbol={symbol}
                x={fanOutSwitchX(place.w, size)}
                y={(size.rowH - 1 - size.switchSize) / 2}
                size={size.switchSize}
                plainClass={plainClass}
              />
            )}
            <text
              data-testid={member.state === null ? "mimic-member-status" : "mimic-breaker-pill"}
              x={place.w - 4}
              y={size.baseline}
              textAnchor="end"
              fontSize={size.text}
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
          y={FANOUT_BAND.top + FANOUT_BAND.perColumn * FANOUT_BAND.rowH + 10}
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
