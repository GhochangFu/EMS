import type { MimicSymbol } from "@bms/shared";

import { mimicCalloutText } from "../../lib/mimic";
import { FANOUT_BAND, type FanOutMemberRow, type FanOutRow } from "../../lib/mimic-breaker";
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
