import { AttributionsList } from "../components/attributions-list";
import { PageHeader } from "../components/page-header";
import { MIMIC_LIBRARY_NOTICES, libraryCredits } from "../components/widgets/mimic-symbol-libraries";
import { AppShell } from "../layouts/app-shell";
import { globalLibraryAttributions } from "../lib/attributions";
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
      <AttributionsList entries={globalLibraryAttributions(MIMIC_LIBRARY_NOTICES, libraryCredits)} />
    </AppShell>
  );
}
