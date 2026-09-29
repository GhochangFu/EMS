import { PageHeader } from "../components/page-header";
import { MIMIC_LIBRARY_NOTICES } from "../components/widgets/mimic-symbol-libraries";
import { AppShell } from "../layouts/app-shell";
import { globalLibraryAttributions, type AttributionEntry } from "../lib/attributions";
import type { AuthUser } from "../stores/auth-store";

/**
 * `F3.32f` slice 1 (ADR 0086 decision 8) — what the product draws with: each symbol library's
 * version, licence, source and notice. Open to every signed-in user; no API call. Every value is
 * a text node, so a notice cannot inject markup.
 */
export function AttributionsPage({ user }: { user: AuthUser }) {
  return (
    <AppShell user={user} kpiRibbon={<span className="text-ink">Attributions · what the product draws with</span>}>
      <PageHeader
        eyebrow="About"
        title="Attributions"
        subtitle="The symbol libraries this product draws with — versions, licences and notices"
      />
      <AttributionsList entries={globalLibraryAttributions(MIMIC_LIBRARY_NOTICES)} />
    </AppShell>
  );
}

export function AttributionsList({ entries }: { entries: readonly AttributionEntry[] }) {
  return (
    <div className="space-y-4">
      {entries.map((entry) => {
        const headingId = `attribution-${entry.code}`;
        return (
          <section key={entry.code} data-testid="attribution-entry" aria-labelledby={headingId} className="space-y-1 rounded border border-line bg-surface p-3 text-ink">
            <h2 id={headingId} className="text-sm font-semibold">
              {entry.name} {entry.version}
            </h2>
            <p className="text-xs text-ink-muted">Licence: {entry.licence}</p>
            {entry.sourceUrl ? (
              <a href={entry.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs underline">
                Source
              </a>
            ) : null}
            {entry.notice ? (
              <details className="text-xs">
                <summary className="cursor-pointer">Licence notice</summary>
                <pre className="mt-1 whitespace-pre-wrap text-xs text-ink-muted">{entry.notice}</pre>
              </details>
            ) : null}
            {entry.credits.length > 0 ? (
              <ul className="list-disc pl-4 text-xs text-ink-muted">
                {entry.credits.map((credit) => (
                  <li key={`${credit.file}-${credit.author}`}>
                    {credit.file} — {credit.author} — {credit.licence}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
