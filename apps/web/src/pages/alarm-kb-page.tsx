import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import type { AlarmKbAlarm, AlarmKbClass } from "@bms/shared";

import { alarmKbQueryKey, fetchAlarmKb } from "../api/alarm-kb";
import { AppShell } from "../layouts/app-shell";
import { PageHeader } from "../components/page-header";
import { SectionCard } from "../components/section-card";
import type { AuthUser } from "../stores/auth-store";

type AlarmKbPageProps = {
  user: AuthUser;
};

/**
 * `E2.2` PR 2 (ADR 0059 decision 4) — the browsable alarm philosophy knowledge
 * base, one entry per published asset class.
 *
 * **The counterpart to the block on the Alarm Details panel, and it fails in the
 * opposite direction.** That block resolves only through a seeded rule's
 * provenance, which 0 of 290 rules on the current database carry; this page
 * reads published templates directly, so it shows the domain packs' authored
 * philosophy whether or not anything has been instantiated. Between them the row
 * has a reader in both states.
 *
 * **Open to `viewer`** (ruling Q0b) — no `AdminRoute`, no role branch here. The
 * template authoring screen shows the same content behind a master-data gate,
 * which is exactly why the operator and the technician could not read it before.
 *
 * Each card names the template version its text comes from, because this page
 * shows the **current published** version while the alarm panel shows the one a
 * rule was **pinned** to. They can legitimately disagree, and a reader has to be
 * able to tell which they are looking at.
 *
 * **The eyebrow is descriptive rather than an `R.*` renderer id**, and that is
 * AGENTS.md §5 rather than a preference: `ESKOM_SMOC.html` defines no `R.kb`,
 * and inventing one would name a mockup surface that does not exist. The
 * closest original renderer is `R.alm`, the Alarm Centre this page sits beside.
 */
export function AlarmKbPage({ user }: AlarmKbPageProps) {
  const [search, setSearch] = useState("");

  const kbQ = useQuery({
    queryKey: alarmKbQueryKey,
    queryFn: fetchAlarmKb,
    staleTime: 5 * 60 * 1000,
  });

  const classes = useMemo(() => kbQ.data?.classes ?? [], [kbQ.data]);
  const query = search.trim().toLowerCase();
  const filtered = useMemo(
    () => classes.filter((entry) => matchesKbSearch(entry, query)),
    [classes, query],
  );

  // Grouped rather than flat: 21 classes across five domains is already more
  // than a person scans linearly, and the domain is the axis they think in.
  const byDomain = useMemo(() => {
    const groups = new Map<string, AlarmKbClass[]>();
    for (const entry of filtered) {
      const list = groups.get(entry.domain) ?? [];
      list.push(entry);
      groups.set(entry.domain, list);
    }
    return [...groups.entries()]
      .map(([domain, entries]) => ({
        domain,
        entries: [...entries].sort((a, b) => a.templateName.localeCompare(b.templateName)),
      }))
      .sort((a, b) => a.domain.localeCompare(b.domain));
  }, [filtered]);

  return (
    <AppShell
      user={user}
      kpiRibbon={
        <span className="text-bms-ink">
          Alarm philosophy · what engineering decided about each asset class
        </span>
      }
    >
      <div className="mx-auto max-w-[1200px] space-y-4 pb-8">
        <PageHeader
          eyebrow="Operations"
          title="Alarm philosophy"
          subtitle="Authored on published asset templates · read-only · the same text an alarm shows when its rule was seeded from one"
        />

        {kbQ.isLoading ? (
          <p className="text-sm text-bms-muted">Loading the knowledge base…</p>
        ) : kbQ.isError ? (
          <p className="text-sm text-red-600" role="alert">
            Could not load the alarm philosophy knowledge base.
          </p>
        ) : (
          <SectionCard
            title="Asset classes"
            subtitle={`${filtered.length} of ${classes.length} published classes shown`}
            actions={
              <label className="flex min-w-[260px] items-center gap-2 text-xs text-bms-muted">
                Search
                <input
                  className="w-full rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-bms-ink"
                  placeholder="Class, alarm code, cause, action…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
            }
          >
            {/*
              Two different empty states, because they are two different facts.
              "No matches" over an empty knowledge base would tell an operator
              their search was wrong when nothing was ever authored — and a
              fresh tenant is genuinely in that state.
            */}
            {classes.length === 0 ? (
              <p className="text-sm text-bms-muted">
                No published asset class carries an alarm philosophy yet. Philosophy is authored on
                a template&apos;s Alarms tab and appears here once that template version is
                published.
              </p>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-bms-muted">
                No class matches this search.
              </p>
            ) : (
              <div className="space-y-6">
                {byDomain.map((group) => (
                  <section key={group.domain} className="space-y-3">
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-bms-muted">
                      {group.domain}
                    </h2>
                    <div className="grid gap-3 lg:grid-cols-2">
                      {group.entries.map((entry) => (
                        <ClassCard key={entry.templateId} entry={entry} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </SectionCard>
        )}
      </div>
    </AppShell>
  );
}

function ClassCard({ entry }: { entry: AlarmKbClass }) {
  return (
    <article
      aria-label={entry.templateName}
      className="rounded border border-gray-200 bg-white p-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-bms-ink">{entry.templateName}</h3>
        <span className="font-mono text-[11px] text-bms-muted">
          {entry.templateCode} v{entry.templateVersion}
        </span>
      </div>
      <ul className="mt-3 space-y-3">
        {entry.alarms.map((alarm) => (
          <li key={alarm.alarmCode} className="border-t border-gray-100 pt-2 first:border-0 first:pt-0">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-[11px] text-bms-muted">{alarm.alarmCode}</span>
              {alarm.message ? (
                <span className="text-xs font-medium text-bms-ink">{alarm.message}</span>
              ) : null}
            </div>
            <dl className="mt-1.5 space-y-1 text-xs">
              {philosophyLines(alarm).map(([label, value]) => (
                <div key={label}>
                  <dt className="font-semibold text-bms-ink">{label}</dt>
                  <dd className="text-bms-muted">{value}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </article>
  );
}

/**
 * The same four labels the alarm panel uses, and deliberately not the
 * enrichment's — a reader who sees both surfaces should recognise class text on
 * sight (ADR 0059 decision 5). A field with no text is dropped rather than shown
 * as a dash.
 */
function philosophyLines(alarm: AlarmKbAlarm): [string, string][] {
  // Typed as a mutable tuple array rather than `as const`: a readonly literal
  // gives each entry its own singleton label type, which the narrowing
  // predicate below cannot then be assignable to.
  const pairs: [string, string | null][] = [
    ["Likely cause", alarm.cause],
    ["Typical impact", alarm.impact],
    ["Recommended action", alarm.action],
    ["Skill required", alarm.skillLabel],
  ];
  return pairs.filter((pair): pair is [string, string] => pair[1] !== null);
}

/** Class name and code, plus every alarm's code, message and philosophy text. */
function matchesKbSearch(entry: AlarmKbClass, query: string): boolean {
  if (!query) {
    return true;
  }
  const haystack = [
    entry.templateName,
    entry.templateCode,
    entry.domain,
    ...entry.alarms.flatMap((alarm) => [
      alarm.alarmCode,
      alarm.message,
      alarm.cause,
      alarm.impact,
      alarm.action,
      alarm.skillLabel,
    ]),
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}
