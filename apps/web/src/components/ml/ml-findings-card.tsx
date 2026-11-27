import { useEffect, useId, useRef, useState, type ReactNode } from "react";
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
import { mlFindingsParagraphCardSchema } from "@bms/shared/contracts";

import { useMlFindings, useMlFindingsParagraphs } from "../../hooks/use-ml-findings";
import {
  compactLines,
  F5_TOOLTIP,
  hasParagraphWorthyCard,
  isParagraphWorthy,
  ML_SUMMARY_COMPACT_POINTS,
  ML_SUMMARY_MAX_POINTS,
  mlPageHref,
  resolveSegments,
  summaryOf,
  type FindingPart,
} from "../../lib/ml-findings";
import type { ScopeFilter } from "../../lib/scope-filter";
import { BotIcon } from "../bot-icon";
import { SectionCard } from "../section-card";
import { StatusPill } from "../status-pill";

/** Decision 1: the section's heading, word for word. */
export const ML_FINDINGS_HEADING = "Findings — advisory";

/** ADR 0135 Amendment 10 Q1 (`E1.9g`): the label of the AI summary box, word for word. */
export const ML_PARAGRAPH_LABEL = "AI summary · advisory";

/** Amendment 10 decision 1: the muted line under the AI text on the full card, word for word. */
export const ML_SUMMARY_NOTE = "Written by AI from the facts below. Check them before you act.";

/** Amendment 10 decision 1: the same line on the compact control-room card, where no facts follow. */
export const ML_SUMMARY_COMPACT_NOTE = "Written by AI from the computed facts.";

/** Amendment 10 decision 5: the plain heading over the facts when the AI box shows. */
export const ML_COMPUTED_FACTS_HEADING = "Computed facts";

/** OQ-2 (a): with the AI box, the first two fact lines show; the rest wait behind "Show N more". */
const FACTS_SHOWN = 2;

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
  /** Decision 13 (the control room): one card per organization, the paragraph or the top lines. */
  compact?: boolean;
};

/**
 * `E1.9g` (Amendment 10 Q3): an asset as a short chip — its code, the full label as its `title`.
 * A safe `href` is a link to the same target as before; an unsafe one is plain text. The web
 * never splits or searches `label`.
 */
function AssetChip({ part }: { part: Extract<FindingPart, { code: string }> }) {
  const chip = "surface-pressed-sm px-1 font-semibold";
  return part.href === null ? (
    <span className={chip} title={part.label}>
      {part.code}
    </span>
  ) : (
    <Link className={`${chip} text-accent-strong hover:underline`} to={part.href} title={part.label}>
      {part.code}
    </Link>
  );
}

/** Resolved parts drawn in order: text as is, an asset as its chip. */
function Parts({ parts }: { parts: readonly FindingPart[] }) {
  return (
    <>
      {parts.map((part, at) => ("text" in part ? <span key={at}>{part.text}</span> : <AssetChip key={at} part={part} />))}
    </>
  );
}

/** A sentence's segments, each asset put back from `assets`: a link only when its `href` is safe. */
function Segments({ segments, assets }: { segments: readonly MlFindingSegment[]; assets: readonly MlFindingAsset[] }) {
  return <Parts parts={resolveSegments(segments, assets)} />;
}

/** `focusAt`: the line that may take focus from script (`tabIndex={-1}`), for "Show N more". */
function FactLines({
  facts,
  assets,
  focusAt,
}: {
  facts: readonly MlFindingFact[];
  assets: readonly MlFindingAsset[];
  focusAt?: number;
}) {
  return (
    <ul data-ml-facts="" className="space-y-1 text-sm text-ink">
      {facts.map((fact, index) => (
        <li
          key={`${fact.id}:${index}`}
          title={fact.id === "F5" ? F5_TOOLTIP : undefined}
          tabIndex={index === focusAt ? -1 : undefined}
        >
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
  const cards: readonly unknown[] = Array.isArray(data?.cards) ? data.cards : [];
  const card = cards.find(
    (c): c is MlFindingsParagraphCard =>
      typeof c === "object" && c !== null && (c as { organizationId?: unknown }).organizationId === organizationId,
  );
  if (card === undefined || card.state !== "ok" || !Array.isArray(card.segments) || card.segments.length === 0) {
    return null;
  }
  // Fail closed on shape too (security review L1): no assets list, a null segment or non-string
  // text would throw in render, and there is no error boundary to catch it.
  return Array.isArray(card.assets) && mlFindingsParagraphCardSchema.safeParse(card).success ? card : null;
}

/**
 * `E1.9g` (ADR 0135 Amendment 10 decisions 1 and 2) — the AI summary box: the mark and the label,
 * the first sentence as a headline, the next ones as points (at most 4, or 2 on the compact card;
 * OQ-1 (a) keeps a hidden "weak" sentence), and the muted note. Info tokens only: never an alarm
 * or severity colour. Its references resolve against the paragraph card's own `assets`, which the
 * server built from the very facts the paragraph was written from (decision 14 and the `E1.9c`
 * security review): never a link from model text, never a summary that may be a cycle newer.
 */
function AiParagraph({ paragraph, compact = false }: { paragraph: MlFindingsParagraphCard; compact?: boolean }) {
  const { headline, points } = summaryOf(
    resolveSegments(paragraph.segments, paragraph.assets),
    compact ? ML_SUMMARY_COMPACT_POINTS : ML_SUMMARY_MAX_POINTS,
  );
  return (
    <div data-ml-paragraph="" className="space-y-1.5 rounded-md border border-info-line bg-info-wash p-3">
      <p className="flex items-center gap-1 text-2xs font-semibold text-info-ink">
        <BotIcon size={12} />
        {ML_PARAGRAPH_LABEL}
      </p>
      <p data-ml-headline="" className="text-sm font-semibold text-ink">
        <Parts parts={headline} />
      </p>
      {points.length > 0 ? (
        <ul data-ml-points="" className="list-disc space-y-0.5 pl-5 text-sm text-ink">
          {points.map((point, at) => (
            <li key={at}>
              <Parts parts={point} />
            </li>
          ))}
        </ul>
      ) : null}
      <p data-ml-note="" className="text-2xs text-ink-muted">
        {compact ? ML_SUMMARY_COMPACT_NOTE : ML_SUMMARY_NOTE}
      </p>
    </div>
  );
}

function cardTitle(card: MlFindingsCardData): string {
  return `${card.organizationCode} · ${card.organizationName}`;
}

/**
 * One organization's fact lines, with its AI summary above them when there is one. With the box,
 * the facts sit under "Computed facts", the first two shown and the rest behind "Show N more"
 * (Amendment 10 decision 5, OQ-2 (a)); the open state lives here, so a remount starts closed.
 * With no box, every line shows with no heading and no button, as before `E1.9g`.
 */
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
  const [open, setOpen] = useState(false);
  const factsRef = useRef<HTMLDivElement>(null);
  const opened = useRef(false);
  // The button is removed on click; keep the keyboard user's place on the first line it showed.
  useEffect(() => {
    if (open && opened.current) {
      opened.current = false;
      factsRef.current?.querySelector<HTMLElement>(`[data-ml-facts] > li:nth-child(${FACTS_SHOWN + 1})`)?.focus();
    }
  }, [open]);
  const hidden = paragraph !== null && !open ? Math.max(0, card.facts.length - FACTS_SHOWN) : 0;
  return (
    <SectionCard
      title={cardTitle(card)}
      subtitle={showKind ? KIND_LABEL[kind] : undefined}
      actions={<StatusPill label="Advisory" tone="info" />}
    >
      <div ref={factsRef} className="space-y-2">
        {paragraph ? <AiParagraph paragraph={paragraph} /> : null}
        {paragraph ? <h3 className="text-xs font-semibold text-ink-muted">{ML_COMPUTED_FACTS_HEADING}</h3> : null}
        <FactLines
          facts={hidden > 0 ? card.facts.slice(0, FACTS_SHOWN) : card.facts}
          assets={card.assets}
          focusAt={paragraph && open ? FACTS_SHOWN : undefined}
        />
        {hidden > 0 ? (
          <button
            type="button"
            className="text-sm font-semibold text-accent-strong hover:underline"
            onClick={() => {
              opened.current = true;
              setOpen(true);
            }}
          >
            Show {hidden} more
          </button>
        ) : null}
      </div>
    </SectionCard>
  );
}

type CompactPart = { kind: MlFindingsKind; card: MlFindingsCardData; paragraph: MlFindingsParagraphCard | null };

/**
 * Decision 13: per kind the AI summary box when `ok` (headline, at most 2 points, the compact
 * note; `E1.9g`), else its top lines; then the pages' links. No "Computed facts" heading here.
 */
function CompactOrganization({ parts, scope, showKind }: { parts: readonly CompactPart[]; scope: ScopeFilter; showKind: boolean }) {
  const first = parts[0];
  if (first === undefined) {
    return null;
  }
  // The card's own organization: a scope with none still opens the page on this card's.
  const pageScope: ScopeFilter = { organizationId: first.card.organizationId, locationId: scope.locationId };
  return (
    <SectionCard title={cardTitle(first.card)} actions={<StatusPill label="Advisory" tone="info" />}>
      <div className="space-y-2">
        {parts.map(({ kind, card, paragraph }) => (
          <div key={kind} className="space-y-1">
            {showKind ? <p className="text-2xs font-semibold text-ink-muted">{KIND_LABEL[kind]}</p> : null}
            {paragraph ? (
              <AiParagraph paragraph={paragraph} compact />
            ) : (
              <FactLines facts={compactLines(card, kind)} assets={card.assets} />
            )}
          </div>
        ))}
        <p className="flex gap-4 text-sm">
          {parts.map(({ kind }) => (
            <Link key={kind} className="font-semibold text-accent-strong hover:underline" to={mlPageHref(kind, pageScope)}>
              Open {kind}
            </Link>
          ))}
        </p>
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
export function MlFindingsCard({ kinds, scope, enabled = true, paragraph = true, compact = false }: MlFindingsCardProps) {
  const headingId = useId();
  const results = useMlFindings(kinds, scope, enabled);
  const asking = results.map((q) => enabled && paragraph && hasParagraphWorthyCard(q.data));
  const paragraphs = useMlFindingsParagraphs(kinds, scope, asking);
  const nothing = results.every((q) => q.data !== undefined && q.data.cards.length === 0);
  if (nothing) {
    return null;
  }
  const showKind = kinds.length > 1;
  // Only while the read is live and this organization's current card still has findings: a
  // disabled query keeps its cached answer, which must not outlive the facts it was written from.
  const paragraphOf = (index: number, card: MlFindingsCardData) =>
    asking[index] === true && isParagraphWorthy(card) ? okParagraph(paragraphs[index]?.data, card.organizationId) : null;

  const statusLines = kinds.map((kind, index) => {
    const q = results[index];
    const findings = showKind ? `${KIND_WORD[kind]} findings` : "findings";
    if (q === undefined || q.data !== undefined) {
      return null;
    }
    // `isPending`, not `isLoading`: a held or paused read must not read as "no findings".
    return (
      <p key={kind} className="text-sm text-ink-muted">
        {q.isPending ? `Loading ${findings}…` : `Could not load the ${findings}.`}
      </p>
    );
  });

  let body: ReactNode;
  if (compact) {
    const byOrganization = new Map<string, CompactPart[]>();
    kinds.forEach((kind, index) => {
      for (const card of results[index]?.data?.cards ?? []) {
        const parts = byOrganization.get(card.organizationId) ?? [];
        parts.push({ kind, card, paragraph: paragraphOf(index, card) });
        byOrganization.set(card.organizationId, parts);
      }
    });
    body = [...byOrganization].map(([organizationId, parts]) => (
      <CompactOrganization key={organizationId} parts={parts} scope={scope} showKind={showKind} />
    ));
  } else {
    body = kinds.map((kind, index) =>
      statusLines[index] ?? (results[index]?.data?.cards ?? []).map((card) => (
        <OrganizationFindings
          key={`${kind}:${card.organizationId}`}
          card={card}
          kind={kind}
          showKind={showKind}
          paragraph={paragraphOf(index, card)}
        />
      )),
    );
  }

  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h2 id={headingId} className="font-condensed text-sm font-bold text-ink">
        {ML_FINDINGS_HEADING}
      </h2>
      {compact ? statusLines : null}
      {body}
    </section>
  );
}
