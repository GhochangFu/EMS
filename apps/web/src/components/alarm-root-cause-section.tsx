import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import type { RootCauseCandidate, RootCauseContext } from "@bms/shared/contracts";

import { fetchRootCauseSuggestions } from "../api/alarms";
import { assetHistoryPath, MAX_HISTORY_POINTS, rangeToSearch } from "../lib/asset-history-range";
import {
  anomalyContextLine,
  candidateHeading,
  evidenceLine,
  rootCauseFillText,
  strengthWord,
} from "../lib/root-cause-suggestions";
import { StatusPill } from "./status-pill";

export const ROOT_CAUSE_SECTION_TITLE = "Possible causes — advisory";
export const ROOT_CAUSE_DISCLAIMER = "Suggestions from past records and live data. Not a diagnosis — check on site.";
export const ROOT_CAUSE_EMPTY_SENTENCE = "No likely cause found in the data.";
export const ROOT_CAUSE_FAILED_SENTENCE = "Suggestions could not be loaded.";

type AlarmRootCauseSectionProps = {
  alarmId: string;
  /** The alarm's asset: the context line links to its history. A device alarm gets no section (§17 Q4). */
  assetId: string;
  /**
   * Hands a candidate's fill text to the enrichment wizard. Absent where the form is not shown
   * (a `viewer`, a read-only panel), so no button is drawn (ADR 0136 decision 6).
   */
  onUse?: (text: string) => void;
};

/** The asset's history for the context window, with its contributing points charted (plan R-m). */
function contextHref(assetId: string, ctx: RootCauseContext): string {
  const search = rangeToSearch({
    range: "custom",
    from: ctx.from,
    to: ctx.to,
    compare: false,
    points: ctx.contributingPoints.slice(0, MAX_HISTORY_POINTS),
    fn: "avg",
  });
  return `${assetHistoryPath(assetId)}?${search.toString()}`;
}

function CandidateItem({ candidate, onUse }: { candidate: RootCauseCandidate; onUse?: (text: string) => void }) {
  const heading = candidateHeading(candidate);
  // `null` for R5: class text is never filled into an instance root cause (ADR 0059 Q1).
  const fill = rootCauseFillText(candidate);
  return (
    <li className="surface-pressed px-3 py-2">
      <p className="font-medium text-ink">{heading}</p>
      <p className="text-2xs text-ink-muted">Strength: {strengthWord(candidate.strength)}</p>
      {candidate.evidence.length > 0 ? (
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-2xs text-ink-muted">
          {candidate.evidence.map((item, index) => (
            <li key={`${item.kind}:${item.alarmId ?? item.at ?? ""}:${index}`}>{evidenceLine(item)}</li>
          ))}
        </ul>
      ) : null}
      <div className="mt-1 flex flex-wrap items-center gap-3">
        {candidate.rule === "class_cause" ? (
          <Link to="/alarm-kb" target="_blank" rel="noopener noreferrer" className="text-2xs text-ink underline hover:text-ink-muted">
            Open the alarm knowledge base
          </Link>
        ) : null}
        {onUse !== undefined && fill !== null ? (
          <button
            type="button"
            className="surface-button px-2 py-0.5 text-2xs"
            aria-label={`Use as root cause: ${heading}`}
            onClick={() => onUse(fill)}
          >
            Use as root cause
          </button>
        ) : null}
      </div>
    </li>
  );
}

/**
 * `E2.3` (ADR 0136 decision 6, plan §7 T2.3) — "Possible causes — advisory" on the alarm
 * details panel, between the class philosophy and the enrichment form. It mounts inside the
 * panel's loaded branch, so its read starts after the details; a failed read is one muted
 * sentence and leaves the rest of the panel working (`retry: false`, no alert). New tabs for its
 * links: leaving the page would unmount the panel and lose a fill not yet submitted.
 *
 * Advisory throughout: the Anomalies page's `Advisory` pill (R-j), the disclaimer, a strength
 * word and never a number, and the ink and neutral roles only — no alarm or severity colour
 * (AGENTS.md §5). Only the context line and R5 link (R-m). The button fills the form and sends
 * nothing; the operator still submits.
 */
export function AlarmRootCauseSection({ alarmId, assetId, onUse }: AlarmRootCauseSectionProps) {
  const q = useQuery({
    queryKey: ["alarms", "root-cause", alarmId],
    queryFn: () => fetchRootCauseSuggestions(alarmId),
    retry: false,
    // Computed when the panel opens (plan §13): no background re-read to fail and hide them.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const data = q.data;

  return (
    <section aria-label={ROOT_CAUSE_SECTION_TITLE} className="rounded border border-line px-3 py-2">
      <details open>
        <summary className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-ink">
          <span>{ROOT_CAUSE_SECTION_TITLE}</span>
          <StatusPill label="Advisory" tone="info" />
        </summary>
        <p className="mt-0.5 text-2xs text-ink-muted">{ROOT_CAUSE_DISCLAIMER}</p>
        <div className="mt-2 space-y-2 text-xs">
          {data === undefined ? (
            // Data first: a later failed read never hides candidates already loaded.
            <p className="text-ink-muted">{q.isError ? ROOT_CAUSE_FAILED_SENTENCE : "Looking for likely causes…"}</p>
          ) : (
            <>
              {data.candidates.length === 0 ? (
                <p className="text-ink-muted">{ROOT_CAUSE_EMPTY_SENTENCE}</p>
              ) : (
                <ul className="space-y-2">
                  {data.candidates.map((candidate) => (
                    <CandidateItem key={`${candidate.rule}:${candidate.quote ?? candidate.title}`} candidate={candidate} onUse={onUse} />
                  ))}
                </ul>
              )}
              {data.context.map((ctx) => (
                <p key={`${ctx.kind}:${ctx.from}`} className="text-2xs">
                  <Link to={contextHref(assetId, ctx)} target="_blank" rel="noopener noreferrer" className="text-ink underline hover:text-ink-muted">
                    {anomalyContextLine(ctx)}
                  </Link>
                </p>
              ))}
            </>
          )}
        </div>
      </details>
    </section>
  );
}
