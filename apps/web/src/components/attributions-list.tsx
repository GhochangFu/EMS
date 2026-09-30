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
            {entry.symbolCredits.length > 0 ? (
              <details className="mt-2">
                <summary className="cursor-pointer text-sm text-ink-muted">Per-file credits ({entry.symbolCredits.length})</summary>
                <table aria-label={`${entry.name} per-file credits`} className="mt-2 w-full text-xs">
                  <thead>
                    <tr className="text-left text-ink">
                      <th>Key</th>
                      <th>Author</th>
                      <th>Source</th>
                      <th>Licence</th>
                      <th>Pin</th>
                      <th>Adaptation</th>
                    </tr>
                  </thead>
                  <tbody className="text-ink-muted">
                    {entry.symbolCredits.map((credit) => (
                      <tr key={credit.key} className="border-t border-line">
                        <td>{credit.key}</td>
                        <td>{credit.author}</td>
                        <td>
                          {/^https:\/\//.test(credit.source) ? (
                            <a href={credit.source} target="_blank" rel="noopener noreferrer" className="underline">
                              {credit.source}
                            </a>
                          ) : (
                            credit.source
                          )}
                        </td>
                        <td>
                          {/^https:\/\//.test(credit.licenceUrl) ? (
                            <a href={credit.licenceUrl} target="_blank" rel="noopener noreferrer" className="underline">
                              {credit.licence}
                            </a>
                          ) : (
                            credit.licence
                          )}
                        </td>
                        <td className="font-mono">{credit.pin}</td>
                        <td>{credit.adaptation}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
