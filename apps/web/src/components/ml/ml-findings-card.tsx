import { useId } from "react";
import { Link } from "react-router-dom";

import type { MlFindingsCard as MlFindingsCardData, MlFindingsKind } from "@bms/shared/contracts";

import { useMlFindings } from "../../hooks/use-ml-findings";
import { F5_TOOLTIP, resolveSegments } from "../../lib/ml-findings";
import type { ScopeFilter } from "../../lib/scope-filter";
import { SectionCard } from "../section-card";
import { StatusPill } from "../status-pill";

/** Decision 1: the section's heading, word for word. */
export const ML_FINDINGS_HEADING = "Findings — advisory";

const KIND_LABEL: Record<MlFindingsKind, string> = { forecasts: "Forecasts", anomalies: "Anomalies" };

type MlFindingsCardProps = {
  kinds: readonly MlFindingsKind[];
  scope: ScopeFilter;
  /** `false` holds the read (the page's filter options are still settling). Default `true`. */
  enabled?: boolean;
};

/** One organization's fact lines. An asset is a link only when its `href` is the history page. */
function OrganizationFindings({ card, kind, showKind }: { card: MlFindingsCardData; kind: MlFindingsKind; showKind: boolean }) {
  return (
    <SectionCard
      title={`${card.organizationCode} · ${card.organizationName}`}
      subtitle={showKind ? KIND_LABEL[kind] : undefined}
      actions={<StatusPill label="Advisory" tone="info" />}
    >
      <ul className="space-y-1 text-sm text-ink">
        {card.facts.map((fact, index) => (
          <li key={`${fact.id}:${index}`} title={fact.id === "F5" ? F5_TOOLTIP : undefined}>
            {resolveSegments(fact.segments, card.assets).map((part, at) =>
              "text" in part ? (
                <span key={at}>{part.text}</span>
              ) : part.href === null ? (
                <span key={at} className="font-semibold">
                  {part.label}
                </span>
              ) : (
                <Link key={at} className="font-semibold text-accent-strong hover:underline" to={part.href}>
                  {part.label}
                </Link>
              ),
            )}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

/**
 * `E1.9b` (ADR 0135 Amendment 8 decisions 1, 2 and 14; plan T2.4) — the "Findings — advisory"
 * section: one `SectionCard` per organization card the API returns, in its order, each with the
 * Advisory pill and its fixed fact sentences. Every named asset links to its history page; an asset
 * that is only counted is not named, so it has no link. The list language of §5: role tokens only,
 * never an alarm or severity colour, and a failed read is a muted sentence, not an alert. When every
 * read answers no cards, nothing is drawn.
 */
export function MlFindingsCard({ kinds, scope, enabled = true }: MlFindingsCardProps) {
  const headingId = useId();
  const results = useMlFindings(kinds, scope, enabled);
  const nothing = results.every((q) => q.data !== undefined && q.data.cards.length === 0);
  if (nothing) {
    return null;
  }
  const showKind = kinds.length > 1;

  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h2 id={headingId} className="font-condensed text-sm font-bold text-ink">
        {ML_FINDINGS_HEADING}
      </h2>
      {kinds.map((kind, index) => {
        const q = results[index];
        if (q === undefined) {
          return null;
        }
        if (q.isPending) {
          // `isPending`, not `isLoading`: a held or paused read must not read as "no findings".
          return (
            <p key={kind} className="text-sm text-ink-muted">
              Loading findings…
            </p>
          );
        }
        if (q.data === undefined) {
          return (
            <p key={kind} className="text-sm text-ink-muted">
              Could not load the findings.
            </p>
          );
        }
        return q.data.cards.map((card) => (
          <OrganizationFindings key={`${kind}:${card.organizationId}`} card={card} kind={kind} showKind={showKind} />
        ));
      })}
    </section>
  );
}
