import type { AttributionEntry } from "../lib/attributions";

/** `F3.32f` (ADR 0086 decision 8) — one card per library: version, licence, source, notice and credits, all as text nodes. */
export function AttributionsList({ entries }: { entries: readonly AttributionEntry[] }) {
  return (
    <div className="space-y-4">
      {entries.map((entry) => {
        const headingId = `attribution-${entry.code}`;
        return (
          <section key={entry.code} data-testid="attribution-entry" aria-labelledby={headingId} className="surface-raised space-y-1 p-3 text-ink">
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
