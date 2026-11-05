import { useQuery } from "@tanstack/react-query";
import type { PointKeyStateTone, SwitchingStateDto } from "@bms/shared";
import { pointKeyStateToneSchema } from "@bms/shared/contracts";

import { fetchVocabularies, vocabulariesQueryKey } from "../../api/vocabularies";
import { breakerLook } from "../../lib/mimic-breaker";
import { StatusPill } from "../status-pill";
import { BreakerSwitch } from "../widgets/mimic-breaker-switch";

/** One legend entry: a distinct `(label, tone)` pair. */
type SwitchingEntry = { readonly label: string; readonly tone: PointKeyStateTone };

/**
 * `F4.309` (ADR 0088 Amendment 3 decision 5, plan C16) — the switching states the legend draws:
 * each distinct `(label, tone)` once (the valve and the damper share `OPEN`/`CLOSED`), in tone
 * order (`pointKeyStateToneSchema.options`), then by label in code-unit order, so the order does
 * not depend on the browser's locale.
 */
function switchingEntries(states: readonly SwitchingStateDto[]): SwitchingEntry[] {
  const seen = new Map<string, SwitchingEntry>();
  for (const { label, tone } of states) {
    seen.set(JSON.stringify([tone, label]), { label, tone });
  }
  const toneRank = (tone: PointKeyStateTone) => pointKeyStateToneSchema.options.indexOf(tone);
  return [...seen.values()].sort(
    (a, b) => toneRank(a.tone) - toneRank(b.tone) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0),
  );
}

/**
 * `/cr-overview` state legend (`F3.28` task 3.4).
 *
 * Reads the severity vocabulary through the shared `vocabulariesQueryKey`
 * (ADR 0031 Amendment 1) — the same key every other consumer uses, so this
 * never becomes a second fetch of the same nine-row payload.
 *
 * **Order.** Normal first — the vocabulary carries no "ok" row, so this pill
 * is synthesised, never read off `alarmSeverities` — then every active
 * severity by rank ascending (least urgent first), then Offline, always last.
 * There is no Standby state on this page. The sort is load-bearing: removing
 * it must redden the order assertion (`state-legend.spec.tsx`).
 *
 * `F4.309` — **a sibling group, "Switching states"**, after it: the state labels of switching
 * points (`/vocabularies` `switchingStates`, the rows the mimic reads), each beside the mimic's own
 * switch drawing in its tone (`BreakerSwitch` with `breakerLook(tone, null)`, owner ruling Q6), so
 * the key looks like the diagram. The glyph is `aria-hidden`; the label names the entry and is
 * rendered as text. One label can carry two tones (a breaker's OPEN, a valve's flowing OPEN), so
 * each entry also says its tone: a visually hidden suffix, and its `title`. No switching state, no group. The "State legend" group above is unchanged.
 */
export function StateLegend() {
  const vocabQ = useQuery({
    queryKey: vocabulariesQueryKey,
    queryFn: fetchVocabularies,
    staleTime: 5 * 60 * 1000,
  });
  const severities = [...(vocabQ.data?.alarmSeverities ?? [])]
    .filter((severity) => severity.active)
    .sort((a, b) => a.rank - b.rank);

  const switching = switchingEntries(vocabQ.data?.switchingStates ?? []);

  return (
    <>
      <div aria-label="State legend" className="flex flex-wrap items-center gap-2">
        <StatusPill label="Normal" tone="ok" />
        {severities.map((severity) => (
          <StatusPill key={severity.code} label={severity.label} tone={severity.tone} />
        ))}
        <StatusPill label="Offline" tone="offline" />
      </div>
      {switching.length > 0 ? (
        <div role="group" aria-label="Switching states" className="flex flex-wrap items-center gap-2">
          {switching.map((entry) => (
            <span
              key={`${entry.tone}:${entry.label}`}
              title={`${entry.label} (${entry.tone})`}
              className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[10.5px] font-semibold uppercase text-ink-muted"
            >
              <svg viewBox="0 0 24 24" className="h-3 w-3" aria-hidden="true">
                <BreakerSwitch
                  state={entry.tone}
                  look={breakerLook(entry.tone, null)}
                  symbol="breaker"
                  x={0}
                  y={0}
                  size={24}
                  plainClass="fill-ink-muted"
                />
              </svg>
              {entry.label}
              <span className="sr-only">{` (${entry.tone})`}</span>
            </span>
          ))}
        </div>
      ) : null}
    </>
  );
}
