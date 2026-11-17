import { useId } from "react";
import { Link } from "react-router-dom";

import type {
  MlFindingAsset,
  MlFindingFact,
  MlFindingsCard as MlFindingsCardData,
  MlFindingSegment,
  MlFindingsKind,
  MlFindingsParagraphCard,
  MlFindingsParagraphResponse,
} from "@bms/shared/contracts";

import { useMlFindings, useMlFindingsParagraphs } from "../../hooks/use-ml-findings";
import { F5_TOOLTIP, hasParagraphWorthyCard, resolveSegments } from "../../lib/ml-findings";
import type { ScopeFilter } from "../../lib/scope-filter";
import { SectionCard } from "../section-card";
import { StatusPill } from "../status-pill";

/** Decision 1: the section's heading, word for word. */
export const ML_FINDINGS_HEADING = "Findings — advisory";

/** Decision 5 / plan T4.3: the label of the AI-written block, word for word. */
export const ML_PARAGRAPH_LABEL = "AI-written · advisory";

const KIND_LABEL: Record<MlFindingsKind, string> = { forecasts: "Forecasts", anomalies: "Anomalies" };

/** The kind's word inside a sentence, used only when more than one kind shows. */
const KIND_WORD: Record<MlFindingsKind, string> = { forecasts: "forecast", anomalies: "anomaly" };

type MlFindingsCardProps = {
  kinds: readonly MlFindingsKind[];
  scope: ScopeFilter;
  /** `false` holds the read (the page's filter options are still settling). Default `true`. */
  enabled?: boolean;
  /** `false` never asks for the AI paragraph: facts only, no LLM cost. Default `true`. */
  paragraph?: boolean;
};

/** A sentence's segments, each asset put back from `assets`: a link only when its `href` is safe. */
function Segments({ segments, assets }: { segments: readonly MlFindingSegment[]; assets: readonly MlFindingAsset[] }) {
  return (
    <>
      {resolveSegments(segments, assets).map((part, at) =>
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
    </>
  );
}

function FactLines({ facts, assets }: { facts: readonly MlFindingFact[]; assets: readonly MlFindingAsset[] }) {
  return (
    <ul className="space-y-1 text-sm text-ink">
      {facts.map((fact, index) => (
        <li key={`${fact.id}:${index}`} title={fact.id === "F5" ? F5_TOOLTIP : undefined}>
          <Segments segments={fact.segments} assets={assets} />
        </li>
      ))}
    </ul>
  );
}

/**
 * The organization's paragraph when, and only when, it is `ok` with text. `none`, `pending`, a
 * failed or unanswered read, and a missing entry all give `null`: decision 5 fails closed, silently.
 */
function okParagraph(data: MlFindingsParagraphResponse | undefined, organizationId: string): MlFindingsParagraphCard | null {
  const card = data?.cards.find((c) => c.organizationId === organizationId);
  return card !== undefined && card.state === "ok" && card.segments.length > 0 ? card : null;
}

/**
 * The AI-written block. Its references resolve against the paragraph card's own `assets`, which
 * the server built from the very facts the paragraph was written from (decision 14 and the `E1.9c`
 * security review): never a link from model text, never a summary that may be a cycle newer.
 */
function AiParagraph({ paragraph }: { paragraph: MlFindingsParagraphCard }) {
  return (
    <div data-ml-paragraph="" className="border-l-2 border-info-line pl-3">
      <p className="text-2xs font-semibold text-info-ink">{ML_PARAGRAPH_LABEL}</p>
      <p className="text-sm text-ink">
        <Segments segments={paragraph.segments} assets={paragraph.assets} />
      </p>
    </div>
  );
}

function cardTitle(card: MlFindingsCardData): string {
  return `${card.organizationCode} · ${card.organizationName}`;
}

/** One organization's fact lines, with its AI paragraph above them when there is one. */
function OrganizationFindings({
  card,
  kind,
  showKind,
  paragraph,
}: {
  card: MlFindingsCardData;
  kind: MlFindingsKind;
  showKind: boolean;
  paragraph: MlFindingsParagraphCard | null;
}) {
  return (
    <SectionCard
      title={cardTitle(card)}
      subtitle={showKind ? KIND_LABEL[kind] : undefined}
      actions={<StatusPill label="Advisory" tone="info" />}
    >
      <div className="space-y-2">
        {paragraph ? <AiParagraph paragraph={paragraph} /> : null}
        <FactLines facts={card.facts} assets={card.assets} />
      </div>
    </SectionCard>
  );
}

/**
 * `E1.9b` / `E1.9d` (ADR 0135 Amendment 8 decisions 1, 2, 5, 13 and 14; plan T2.4, T4.3) — the
 * "Findings — advisory" section: one `SectionCard` per organization card the API returns, in its
 * order, each with the Advisory pill and its fixed fact sentences. Every named asset links to its
 * history page; an asset that is only counted is not named, so it has no link. The list language
 * of §5: role tokens only, never an alarm or severity colour, and a failed read is a muted
 * sentence, not an alert. When every read answers no cards, nothing is drawn.
 *
 * The AI paragraph is asked for only after the summary has a card with findings, and the facts
 * never wait for it. Only an `ok` answer draws anything; every other outcome draws nothing at all.
 */
export function MlFindingsCard({ kinds, scope, enabled = true, paragraph = true }: MlFindingsCardProps) {
  const headingId = useId();
  const results = useMlFindings(kinds, scope, enabled);
  const paragraphs = useMlFindingsParagraphs(
    kinds,
    scope,
    results.map((q) => enabled && paragraph && hasParagraphWorthyCard(q.data)),
  );
  const nothing = results.every((q) => q.data !== undefined && q.data.cards.length === 0);
  if (nothing) {
    return null;
  }
  const showKind = kinds.length > 1;
  const paragraphOf = (index: number, organizationId: string) =>
    paragraph ? okParagraph(paragraphs[index]?.data, organizationId) : null;

  const body = kinds.map((kind, index) => {
    const q = results[index];
    const findings = showKind ? `${KIND_WORD[kind]} findings` : "findings";
    if (q === undefined) {
      return null;
    }
    if (q.data === undefined) {
      // `isPending`, not `isLoading`: a held or paused read must not read as "no findings".
      return (
        <p key={kind} className="text-sm text-ink-muted">
          {q.isPending ? `Loading ${findings}…` : `Could not load the ${findings}.`}
        </p>
      );
    }
    return q.data.cards.map((card) => (
      <OrganizationFindings
        key={`${kind}:${card.organizationId}`}
        card={card}
        kind={kind}
        showKind={showKind}
        paragraph={paragraphOf(index, card.organizationId)}
      />
    ));
  });

  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h2 id={headingId} className="font-condensed text-sm font-bold text-ink">
        {ML_FINDINGS_HEADING}
      </h2>
      {body}
    </section>
  );
}
