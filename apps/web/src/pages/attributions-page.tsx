import type { MimicOrgSymbolLibraryDto } from "@bms/shared";

import { AttributionsList } from "../components/attributions-list";
import { PageHeader } from "../components/page-header";
import { MIMIC_LIBRARY_NOTICES, libraryCredits } from "../components/widgets/mimic-symbol-libraries";
import { useMimicSymbolLibraries } from "../hooks/use-mimic-symbol-libraries";
import { AppShell } from "../layouts/app-shell";
import { globalLibraryAttributions } from "../lib/attributions";
import type { AuthUser } from "../stores/auth-store";

/**
 * `F3.32f` slice 1 (ADR 0086 decision 8) — what the product draws with: each symbol library's
 * version, licence, source and notice. Open to every signed-in user. Every value is a text node,
 * so a notice cannot inject markup.
 *
 * Slice 3 adds the organization's own libraries (decision 8: "each of the organization's own
 * libraries"), read from `GET /mimic-symbol-libraries` with no organization — every organization
 * the caller reads — retired ones included, since a stored drawing still draws with them.
 */
export function AttributionsPage({ user }: { user: AuthUser }) {
  return (
    <AppShell user={user} kpiRibbon={<span className="text-ink">Attributions · what the product draws with</span>}>
      <PageHeader
        eyebrow="About"
        title="Attributions"
        subtitle="The symbol libraries this product draws with — versions, licences and notices"
      />
      <AttributionsList entries={globalLibraryAttributions(MIMIC_LIBRARY_NOTICES, libraryCredits)} />
      <OrganizationLibraries />
    </AppShell>
  );
}

/** Only an `http(s)` source becomes a link: an administrator typed it, and `javascript:` is a URL too. */
function safeSourceUrl(url: string | null): string | null {
  return url !== null && /^https?:\/\//i.test(url) ? url : null;
}

function OrganizationLibrary({ library }: { library: MimicOrgSymbolLibraryDto }) {
  const source = safeSourceUrl(library.sourceUrl);
  return (
    <div data-testid="attribution-org-entry" className="surface-raised space-y-1 p-3 text-ink">
      <h3 className="text-sm font-semibold">{library.label}</h3>
      <p className="text-xs text-ink-muted">Licence: {library.licence}</p>
      {source !== null ? (
        <a href={source} target="_blank" rel="noopener noreferrer" className="text-xs underline">
          Source
        </a>
      ) : null}
      {library.attribution !== "" ? (
        <pre className="whitespace-pre-wrap text-xs text-ink-muted">{library.attribution}</pre>
      ) : null}
    </div>
  );
}

/** "Your organization's libraries" — each library's label, licence and attribution text. */
function OrganizationLibraries() {
  const catalogQ = useMimicSymbolLibraries();
  const libraries = catalogQ.data?.organization ?? [];
  return (
    <section aria-labelledby="attribution-organization-libraries" className="mt-6 space-y-3">
      <h2 id="attribution-organization-libraries" className="text-sm font-semibold text-ink">
        Your organization's libraries
      </h2>
      {catalogQ.isPending ? <p className="text-xs text-ink-muted">Loading the organization's libraries…</p> : null}
      {catalogQ.isError ? <p className="text-xs text-ink-muted">The organization's libraries could not be read.</p> : null}
      {catalogQ.isSuccess && libraries.length === 0 ? <p className="text-xs text-ink-muted">No organization library</p> : null}
      {libraries.map((library) => (
        <OrganizationLibrary key={library.id} library={library} />
      ))}
    </section>
  );
}
