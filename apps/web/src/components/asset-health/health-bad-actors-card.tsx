import { useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Link } from "react-router-dom";

import { assetLabelOf } from "@bms/shared";
import { HEALTH_ANOMALY_CAPTION } from "@bms/shared/contracts";
import type { HealthBadActor, HealthBadActorsAnomaly, HealthBadActorsResponse, HealthLowestScore } from "@bms/shared/contracts";

import { useHealthBadActors } from "../../hooks/use-asset-health";
import { anomalyCountLine, formatHealthScorePercent, healthBandDisplay } from "../../lib/asset-health-view";
import { assetHistoryPath } from "../../lib/asset-history-range";
import { safeAssetHref } from "../../lib/ml-findings";
import { SectionCard } from "../section-card";
import { StatusPill } from "../status-pill";

/** The card's title, word for word (ADR 0050 Amendment 5 decision 4). */
export const HEALTH_BAD_ACTORS_TITLE = "Bad actors — advisory";

type Tab = "anomaly" | "lowest";

const TABS: readonly { key: Tab; label: string }[] = [
  { key: "anomaly", label: "Anomaly history" },
  { key: "lowest", label: "Lowest health score" },
];

type HealthBadActorsCardProps = {
  organizationId?: string;
  locationId?: string;
  /** The site page has no donut (Q2 (a)): its count line sits inside this card. */
  showCount?: boolean;
};

const linkClass = "font-semibold text-accent-strong hover:underline";

/** The asset's label: a link only when the target is safe. */
function AssetName({ label, href }: { label: string; href: string | null }) {
  return href === null ? (
    <span className="font-semibold text-ink">{label}</span>
  ) : (
    <Link className={linkClass} to={href}>
      {label}
    </Link>
  );
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function BadActorRow({ item }: { item: HealthBadActor }) {
  const showScore = item.ruleScore !== null && item.advisoryScore !== null;
  return (
    <li data-testid="bad-actor-row" className="space-y-0.5 border-b border-line py-2 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <AssetName label={assetLabelOf(item)} href={safeAssetHref(item.href)} />
        <span className="text-xs text-ink-muted">{item.assetLocationName}</span>
        <StatusPill label="Advisory" tone="info" />
      </div>
      <p className="text-xs tabular-nums text-ink">
        {`${item.strongHours} h both methods · ${item.baselineOnlyHours} h Baseline only · ${item.unusualHours} unusual in all`}
      </p>
      {item.topPoints.length > 0 ? <p className="text-xs text-ink-muted">{item.topPoints.join(", ")}</p> : null}
      {showScore ? (
        <p className="text-xs tabular-nums text-ink-muted">
          {`Score ${formatHealthScorePercent(item.ruleScore)} → ${formatHealthScorePercent(item.advisoryScore)} with anomaly history`}
        </p>
      ) : null}
      {item.weak ? <p className="text-xs font-semibold text-ink-muted">Weak signal</p> : null}
    </li>
  );
}

/** Anomaly history (plan §4.6): the caption, the rows, the caveat, then the count line on request. */
function AnomalyContent({
  anomaly,
  data,
  showCount,
}: {
  anomaly: HealthBadActorsAnomaly;
  data: HealthBadActorsResponse;
  showCount: boolean;
}) {
  const countLine = showCount ? anomalyCountLine(data) : null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
        <span>{HEALTH_ANOMALY_CAPTION}</span>
        <StatusPill label="Advisory" tone="info" />
      </div>
      {anomaly.items.length === 0 ? (
        <p className="text-sm text-ink-muted">{`No unusual hours in the last ${anomaly.windowDays} days.`}</p>
      ) : (
        <ul>
          {anomaly.items.map((item) => (
            <BadActorRow key={item.assetId} item={item} />
          ))}
        </ul>
      )}
      {anomaly.caveat !== null ? <p className="text-xs text-ink-muted">{anomaly.caveat}</p> : null}
      {countLine !== null ? (
        <div data-testid="bad-actors-count-line" className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          <span className="tabular-nums">{countLine}</span>
          <StatusPill label="Advisory" tone="info" />
        </div>
      ) : null}
    </div>
  );
}

/** Lowest health score (plan §4.7): the rule score, not advisory, so no pill anywhere. */
function LowestContent({ rows }: { rows: readonly HealthLowestScore[] }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-muted">Rule score only. Not advisory.</p>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">No asset has a score yet.</p>
      ) : (
        <ul>
          {rows.map((row) => (
            <li
              key={row.assetId}
              data-testid="lowest-score-row"
              className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-line py-2 text-sm last:border-b-0"
            >
              <AssetName label={assetLabelOf(row)} href={assetHistoryPath(row.assetId)} />
              <span className="text-xs text-ink-muted">{row.assetLocationName}</span>
              <span className="tabular-nums text-ink">{formatHealthScorePercent(row.score)}</span>
              <span className="text-xs text-ink-muted">{healthBandDisplay(row.band)}</span>
              <span className="text-xs tabular-nums text-ink-muted">{plural(row.scoredTagCount, "scored tag")}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * `E1.8c` (ADR 0050 Amendment 5 decisions 4–7; plan §4.6–4.8, R-f, R-j, R-m, R-n) — the *Bad
 * actors — advisory* card on the control-room organization and site pages. Two tabs, local state:
 * **Anomaly history** (default, advisory: a pill on each row and beside the caption, never in the
 * header) and **Lowest health score** (the rule score, not advisory). Every anomaly-row link goes
 * through `safeAssetHref`; a Lowest row links to the asset's history page. The list language of
 * §5: role classes only, never a band, alarm or severity colour. `anomaly: null` keeps only the
 * Lowest content with no tab strip; with no Lowest row either, the card is not drawn.
 */
export function HealthBadActorsCard({ organizationId, locationId, showCount = false }: HealthBadActorsCardProps) {
  const [tab, setTab] = useState<Tab>("anomaly");
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const baseId = useId();
  const query = useHealthBadActors({ organizationId, locationId }, true);
  const data = query.data;

  // WAI-ARIA tabs, as `dashboard-tab-strip.tsx`: arrows wrap, Home and End jump; each selects and
  // focuses. Only the selected tab is in the Tab order (code review, E1.8c).
  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    const last = TABS.length - 1;
    const target =
      event.key === "ArrowRight"
        ? (index + 1) % TABS.length
        : event.key === "ArrowLeft"
          ? (index - 1 + TABS.length) % TABS.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    const next = target === null ? undefined : TABS[target];
    if (target === null || next === undefined) {
      return;
    }
    event.preventDefault();
    setTab(next.key);
    tabButtons.current[target]?.focus();
  }

  if (data !== undefined && data.anomaly === null && data.lowestScores.length === 0) {
    return null;
  }

  let body;
  if (data === undefined) {
    body = <p className="text-sm text-ink-muted">{query.isPending ? "Loading…" : "Could not load this list."}</p>;
  } else if (data.anomaly === null) {
    body = <LowestContent rows={data.lowestScores} />;
  } else {
    body = (
      <div className="space-y-3">
        <div role="tablist" aria-label="Bad actors lists" className="flex flex-wrap gap-1 border-b border-line pb-2">
          {TABS.map((entry, index) => (
            <button
              key={entry.key}
              ref={(el) => {
                tabButtons.current[index] = el;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${entry.key}`}
              aria-selected={entry.key === tab}
              aria-controls={`${baseId}-panel`}
              tabIndex={entry.key === tab ? 0 : -1}
              onClick={() => setTab(entry.key)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
              className={`surface-tab px-3 py-1.5 text-sm ${entry.key === tab ? "surface-tab-selected" : ""}`}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`${baseId}-panel`} aria-labelledby={`${baseId}-tab-${tab}`}>
          {tab === "anomaly" ? (
            <AnomalyContent anomaly={data.anomaly} data={data} showCount={showCount} />
          ) : (
            <LowestContent rows={data.lowestScores} />
          )}
        </div>
      </div>
    );
  }

  return (
    <SectionCard title={HEALTH_BAD_ACTORS_TITLE} bodyClassName="p-3">
      {body}
    </SectionCard>
  );
}
