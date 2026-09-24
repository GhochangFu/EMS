import { useQuery } from "@tanstack/react-query";

import { fetchVocabularies, vocabulariesQueryKey } from "../../api/vocabularies";
import { StatusPill } from "../status-pill";

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

  return (
    <div aria-label="State legend" className="flex flex-wrap items-center gap-2">
      <StatusPill label="Normal" tone="ok" />
      {severities.map((severity) => (
        <StatusPill key={severity.code} label={severity.label} tone={severity.tone} />
      ))}
      <StatusPill label="Offline" tone="offline" />
    </div>
  );
}
